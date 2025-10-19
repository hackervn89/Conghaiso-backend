const db = require('../config/database');
const { CustomError } = require('./errors');

/**
 * Xây dựng các mệnh đề WHERE và JOIN động cho truy vấn công việc.
 * @param {object} user - Đối tượng người dùng hiện tại.
 * @param {object} filters - Các bộ lọc từ query string.
 * @returns {object} - Chứa chuỗi where, joins và mảng params.
 */
const buildTaskQuery = (user, filters) => {
    const { dynamicStatus, orgId, searchTerm } = filters;
    const whereClauses = [];
    const joins = new Set();
    const params = [];
    let paramIndex = 1;

    // Phân quyền: User thường chỉ thấy công việc họ tạo, được giao, hoặc theo dõi.
    // Admin/Secretary thấy tất cả.
    if (user.role !== 'Admin' && user.role !== 'Secretary') {
        joins.add('LEFT JOIN task_trackers tt ON t.task_id = tt.task_id');
        joins.add('LEFT JOIN task_assigned_orgs tao ON t.task_id = tao.task_id');
        joins.add('LEFT JOIN user_organizations uo ON tao.org_id = uo.org_id');
        whereClauses.push(`(t.creator_id = $${paramIndex} OR tt.user_id = $${paramIndex} OR uo.user_id = $${paramIndex})`);
        params.push(user.user_id);
        paramIndex++;
    }

    // Lọc theo trạng thái động
    if (dynamicStatus) {
        const now = 'CURRENT_TIMESTAMP';
        const statusArray = Array.isArray(dynamicStatus) ? dynamicStatus : String(dynamicStatus).split(',').map(s => s.trim());
        const statusConditions = [];

        statusArray.forEach(statusItem => {
            switch (statusItem) {
                case 'pending':
                    // [FIX] Đồng bộ với ENUM trong CSDL: 'pending' -> 'new'
                    statusConditions.push(`(t.status = $${paramIndex} AND (t.due_date IS NULL OR t.due_date >= ${now}))`);
                    params.push('new');
                    paramIndex++;
                    break;
                case 'doing':
                    // [FIX] Đồng bộ với ENUM trong CSDL: 'doing' -> 'in_progress'
                    statusConditions.push(`(t.status = $${paramIndex} AND (t.due_date IS NULL OR t.due_date >= ${now}))`);
                    params.push('in_progress');
                    paramIndex++;
                    break;
                case 'overdue':
                    // [FIX] Đồng bộ với ENUM trong CSDL
                    statusConditions.push(`(t.status IN ($${paramIndex}, $${paramIndex+1}) AND t.due_date < ${now})`);
                    params.push('new', 'in_progress');
                    paramIndex += 2;
                    break;
                case 'completed':
                    // Sử dụng tham số hóa
                    statusConditions.push(`t.status = $${paramIndex}`);
                    params.push('completed');
                    paramIndex++;
                    break;
                // Các trường hợp khác từ code mới của bạn (giữ nguyên)
                // [FIX] Sử dụng tham số hóa cho 'completed' để tránh lỗi ENUM
                case 'completed_on_time':
                    statusConditions.push(`(t.status = $${paramIndex} AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at <= t.due_date)`);
                    params.push('completed');
                    paramIndex++;
                    break;
                // [FIX] Sử dụng tham số hóa cho 'completed' để tránh lỗi ENUM
                case 'completed_late':
                    statusConditions.push(`(t.status = $${paramIndex} AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at > t.due_date)`);
                    params.push('completed');
                    paramIndex++;
                    break;
            }
        });

        if (statusConditions.length > 0) {
            whereClauses.push(`(${statusConditions.join(' OR ')})`);
        }
    }

    // Lọc theo phòng ban được giao
    if (orgId) {
        joins.add('JOIN task_assigned_orgs tao_filter ON t.task_id = tao_filter.task_id');
        whereClauses.push(`tao_filter.org_id = $${paramIndex}`);
        params.push(orgId);
        paramIndex++;
    }

    // Lọc theo từ khóa tìm kiếm
    if (searchTerm) {
        whereClauses.push(`t.title ILIKE $${paramIndex}`);
        params.push(`%${searchTerm}%`);
        paramIndex++;
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const joinString = [...joins].join(' ');

    return { whereString, joinString, params, paramIndex };
};

const findAll = async (user, filters) => {
    const { page, limit, sortBy, sortDirection } = filters;
    const offset = (page - 1) * limit;

    const { whereString, joinString, params, paramIndex } = buildTaskQuery(user, filters);

    // --- [NEW] Xây dựng mệnh đề ORDER BY động và an toàn ---
    const buildOrderByClause = () => {
        const allowedSortBy = {
            'created_at': 't.created_at',
            'due_date': 't.due_date',
            'priority': `CASE t.priority WHEN 'urgent' THEN 3 WHEN 'important' THEN 2 ELSE 1 END`
        };

        const sortByFields = sortBy ? String(sortBy).split(',') : ['created_at'];
        const sortDirections = sortDirection ? String(sortDirection).split(',') : ['desc'];

        const orderByParts = sortByFields.map((field, index) => {
            const cleanField = field.trim();
            const sortColumn = allowedSortBy[cleanField];
            if (!sortColumn) return null; // Bỏ qua nếu cột không hợp lệ

            const direction = (sortDirections[index]?.trim().toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
            return `${sortColumn} ${direction} NULLS LAST`;
        }).filter(Boolean); // Lọc ra các giá trị null

        if (orderByParts.length === 0) {
            // Mặc định nếu không có tiêu chí hợp lệ nào
            return { clause: 'ORDER BY t.created_at DESC NULLS LAST', extraSelect: ', t.created_at' };
        }

        // [FIX] Đảm bảo tất cả các cột/biểu thức trong ORDER BY đều có trong SELECT DISTINCT
        const extraSelectParts = new Set();
        sortByFields.forEach(field => {
            const sortColumn = allowedSortBy[field.trim()];
            if (sortColumn) extraSelectParts.add(sortColumn);
        });

        return { clause: `ORDER BY ${orderByParts.join(', ')}`, extraSelect: [...extraSelectParts].map(p => `, ${p}`).join('') };
    };

    const { clause: orderByClause, extraSelect: extraSelectColumn } = buildOrderByClause();

    // --- 1. Thực thi 2 truy vấn song song: Đếm tổng số và Lấy ID của trang hiện tại ---
    const countQuery = `SELECT COUNT(DISTINCT t.task_id) FROM tasks t ${joinString} ${whereString}`;
    
    const dataQuery = `
        SELECT DISTINCT t.task_id ${extraSelectColumn}
        FROM tasks t
        ${joinString}
        ${whereString}
        ${orderByClause}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const [countResult, taskIdsResult] = await Promise.all([
        db.query(countQuery, params),
        db.query(dataQuery, [...params, limit, offset])
    ]);

    const totalTasks = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalTasks / limit);
    const taskIds = taskIdsResult.rows.map(row => row.task_id);

    if (taskIds.length === 0) {
        return {
            tasks: [],
            currentPage: page,
            totalPages: totalPages,
            totalTasks: totalTasks
        };
    }

    // --- 2. Lấy thông tin chi tiết cho các công việc trong trang hiện tại ---
    const tasksQuery = `
        SELECT 
            t.*, 
            creator.full_name as creator_name,
            -- [FIX] Cải tiến logic dynamic_status để nhất quán và ánh xạ đúng ENUM từ CSDL
            CASE
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at <= t.due_date THEN 'completed_on_time'
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at > t.due_date THEN 'completed_late'
                WHEN t.status IN ('new', 'in_progress') AND t.due_date IS NOT NULL AND t.due_date < CURRENT_TIMESTAMP THEN 'overdue'
                WHEN t.status = 'new' THEN 'pending'
                WHEN t.status = 'in_progress' THEN 'doing'
                ELSE t.status::text
            END as dynamic_status
        FROM tasks t
        JOIN users creator ON t.creator_id = creator.user_id
        WHERE t.task_id = ANY($1::int[])
        -- [FIX] Sắp xếp theo thứ tự của mảng taskIds để đảm bảo nhất quán với phân trang
        ORDER BY array_position($1::int[], t.task_id)
    `;

    const assignedOrgsQuery = `
        -- [FIX] Sửa tên cột từ 'name' thành 'org_name' để khớp với CSDL
        SELECT tao.task_id, o.org_id, o.org_name AS name
        FROM task_assigned_orgs tao
        JOIN organizations o ON tao.org_id = o.org_id
        WHERE tao.task_id = ANY($1::int[])
    `;

    const trackersQuery = `
        SELECT tt.task_id, u.user_id, u.full_name
        FROM task_trackers tt
        JOIN users u ON tt.user_id = u.user_id
        WHERE tt.task_id = ANY($1::int[])
    `;

    const [tasksResult, orgsResult, trackersResult] = await Promise.all([
        db.query(tasksQuery, [taskIds]),
        db.query(assignedOrgsQuery, [taskIds]),
        db.query(trackersQuery, [taskIds])
    ]);

    const tasks = tasksResult.rows;
    const assignedOrgs = orgsResult.rows;
    const trackers = trackersResult.rows;

    // --- 3. Gộp dữ liệu lại ---
    const tasksMap = new Map(tasks.map(task => [task.task_id, { ...task, assignedOrgs: [], trackers: [] }]));

    assignedOrgs.forEach(org => {
        if (tasksMap.has(org.task_id)) {
            tasksMap.get(org.task_id).assignedOrgs.push({ org_id: org.org_id, name: org.name });
        }
    });

    trackers.forEach(tracker => {
        if (tasksMap.has(tracker.task_id)) {
            tasksMap.get(tracker.task_id).trackers.push({ user_id: tracker.user_id, full_name: tracker.full_name });
        }
    });

    // [FIX] Sắp xếp lại kết quả cuối cùng theo đúng thứ tự ID đã phân trang
    const sortedTasks = taskIds.map(id => tasksMap.get(id)).filter(Boolean);


    // Trả về kết quả theo đúng cấu trúc yêu cầu
    return {
        tasks: sortedTasks,
        currentPage: page,
        totalPages: totalPages,
        totalTasks: totalTasks
    };
};

/**
 * Lấy thống kê tóm tắt về công việc cho dashboard.
 * Hiện tại, chỉ đếm số công việc trễ hạn.
 * @param {object} user - Đối tượng người dùng hiện tại.
 * @returns {Promise<object>} - Một đối tượng chứa số lượng công việc trễ hạn.
 */
const getTasksSummary = async (user) => {
    // Tái sử dụng logic xây dựng query để áp dụng phân quyền
    const { whereString, joinString, params } = buildTaskQuery(user, {});

    // Thêm điều kiện để chỉ đếm các công việc trễ hạn
    const overdueCondition = `t.status IN ('new', 'in_progress') AND t.due_date < CURRENT_TIMESTAMP`;
    
    // Kết hợp điều kiện WHERE có sẵn (nếu có) với điều kiện trễ hạn
    const finalWhereString = whereString 
        ? `${whereString} AND ${overdueCondition}`
        : `WHERE ${overdueCondition}`;

    const summaryQuery = `
        SELECT COUNT(DISTINCT t.task_id) as overdue_tasks
        FROM tasks t
        ${joinString}
        ${finalWhereString}
    `;
    const { rows } = await db.query(summaryQuery, params);
    return { overdueTasks: parseInt(rows[0].overdue_tasks, 10) || 0 };
};

// [FIX] Triển khai lại các hàm CRUD còn thiếu

const create = async (taskData, creatorId) => {
    const { title, description, priority, document_ref, due_date, trackerIds = [], assignedOrgIds = [] } = taskData;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const taskQuery = `
            INSERT INTO tasks (title, description, creator_id, priority, document_ref, due_date, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'new')
            RETURNING *;
        `;
        const taskResult = await client.query(taskQuery, [title, description, creatorId, priority, document_ref, due_date]);
        const newTask = taskResult.rows[0];

        if (trackerIds.length > 0) {
            const trackerValues = trackerIds.map(userId => `(${newTask.task_id}, ${userId})`).join(',');
            await client.query(`INSERT INTO task_trackers (task_id, user_id) VALUES ${trackerValues}`);
        }

        if (assignedOrgIds.length > 0) {
            const orgValues = assignedOrgIds.map(orgId => `(${newTask.task_id}, ${orgId})`).join(',');
            await client.query(`INSERT INTO task_assigned_orgs (task_id, org_id) VALUES ${orgValues}`);
        }

        await client.query('COMMIT');
        // Trả về task object đầy đủ để controller có thể sử dụng
        return { ...newTask, trackerIds, assignedOrgIds, documents: [] };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const findById = async (id) => {
    const taskQuery = `
        SELECT 
            t.*, 
            creator.full_name as creator_name,
            CASE
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at <= t.due_date THEN 'completed_on_time'
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at > t.due_date THEN 'completed_late'
                WHEN t.status IN ('new', 'in_progress') AND t.due_date IS NOT NULL AND t.due_date < CURRENT_TIMESTAMP THEN 'overdue'
                WHEN t.status = 'new' THEN 'pending'
                WHEN t.status = 'in_progress' THEN 'doing'
                ELSE t.status::text
            END as dynamic_status
        FROM tasks t
        JOIN users creator ON t.creator_id = creator.user_id
        WHERE t.task_id = $1;
    `;

    const assignedOrgsQuery = `SELECT o.org_id, o.org_name as name FROM task_assigned_orgs tao JOIN organizations o ON tao.org_id = o.org_id WHERE tao.task_id = $1`;
    const trackersQuery = `SELECT u.user_id, u.full_name FROM task_trackers tt JOIN users u ON tt.user_id = u.user_id WHERE tt.task_id = $1`;
    const documentsQuery = `SELECT doc_id, doc_name as name, file_path as "filePath" FROM task_documents WHERE task_id = $1`;

    const [taskResult, orgsResult, trackersResult, documentsResult] = await Promise.all([
        db.query(taskQuery, [id]),
        db.query(assignedOrgsQuery, [id]),
        db.query(trackersQuery, [id]),
        db.query(documentsQuery, [id])
    ]);

    if (taskResult.rows.length === 0) {
        return null;
    }

    const task = taskResult.rows[0];
    task.assignedOrgs = orgsResult.rows;
    task.trackers = trackersResult.rows;
    task.documents = documentsResult.rows;
    // Thêm các ID vào để logic phân quyền ở controller dễ dàng hơn
    task.trackerIds = task.trackers.map(t => t.user_id);
    task.assignedOrgIds = task.assignedOrgs.map(o => o.org_id);

    return task;
};

const update = async (id, taskData) => {
    const { title, description, priority, document_ref, due_date, trackerIds = [], assignedOrgIds = [], documents = [] } = taskData;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const taskQuery = `
            UPDATE tasks
            SET title = $1, description = $2, priority = $3, document_ref = $4, due_date = $5, updated_at = CURRENT_TIMESTAMP
            WHERE task_id = $6
            RETURNING *;
        `;
        await client.query(taskQuery, [title, description, priority, document_ref, due_date, id]);

        // Cập nhật trackers
        await client.query('DELETE FROM task_trackers WHERE task_id = $1', [id]);
        if (trackerIds.length > 0) {
            const trackerValues = trackerIds.map(userId => `(${id}, ${userId})`).join(',');
            await client.query(`INSERT INTO task_trackers (task_id, user_id) VALUES ${trackerValues}`);
        }

        // Cập nhật assigned orgs
        await client.query('DELETE FROM task_assigned_orgs WHERE task_id = $1', [id]);
        if (assignedOrgIds.length > 0) {
            const orgValues = assignedOrgIds.map(orgId => `(${id}, ${orgId})`).join(',');
            await client.query(`INSERT INTO task_assigned_orgs (task_id, org_id) VALUES ${orgValues}`);
        }

        // Cập nhật documents
        await client.query('DELETE FROM task_documents WHERE task_id = $1', [id]);
        if (documents.length > 0) {
            for (const doc of documents) {
                await client.query(
                    'INSERT INTO task_documents (task_id, doc_name, file_path) VALUES ($1, $2, $3)',
                    [id, doc.name, doc.filePath]
                );
            }
        }

        await client.query('COMMIT');
        return findById(id); // Trả về task đã được cập nhật đầy đủ
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const updateStatus = async (id, status, completed_at) => {
    const query = `
        UPDATE tasks
        SET status = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP
        WHERE task_id = $3
        RETURNING *;
    `;
    const { rows } = await db.query(query, [status, completed_at, id]);
    return findById(rows[0].task_id);
};

const remove = async (id) => {
    // ON DELETE CASCADE sẽ tự động xóa các bản ghi liên quan trong task_trackers, task_assigned_orgs, task_documents
    await db.query('DELETE FROM tasks WHERE task_id = $1', [id]);
};

const addDocuments = async (taskId, documents) => {
    if (!documents || documents.length === 0) return;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        for (const doc of documents) {
            await client.query(
                'INSERT INTO task_documents (task_id, doc_name, file_path) VALUES ($1, $2, $3)',
                [taskId, doc.name, doc.filePath]
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    findAll,
    getTasksSummary, // [FIX] Xuất (export) hàm mới
    findById,
    create,
    update,
    updateStatus,
    remove,
    addDocuments
};