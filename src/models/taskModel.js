const db = require('../config/database');
const storageService = require('../services/storageService');

const create = async (taskData, creatorId) => {
    const { 
        title, description, document_ref, is_direct_assignment, 
        due_date, priority, assignedOrgIds, trackerIds, documents 
    } = taskData;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const taskQuery = `
            INSERT INTO tasks (title, description, creator_id, status, priority, document_ref, is_direct_assignment, due_date)
            VALUES ($1, $2, $3, 'new', $4, $5, $6, $7)
            RETURNING *;
        `;
        const taskResult = await client.query(taskQuery, [title, description, creatorId, priority, document_ref, is_direct_assignment, due_date || null]);
        const newTask = taskResult.rows[0];

        if (assignedOrgIds && assignedOrgIds.length > 0) {
            const orgValues = assignedOrgIds.map(orgId => `(${newTask.task_id}, ${orgId})`).join(', ');
            await client.query(`INSERT INTO task_assigned_orgs (task_id, org_id) VALUES ${orgValues};`);
        }

        if (trackerIds && trackerIds.length > 0) {
            const trackerValues = trackerIds.map(userId => `(${newTask.task_id}, ${userId})`).join(', ');
            await client.query(`INSERT INTO task_trackers (task_id, user_id) VALUES ${trackerValues};`);
        }

        if (documents && documents.length > 0) {
             for (const doc of documents) {
                if (doc.name && doc.filePath) {
                    const docQuery = `INSERT INTO task_documents (task_id, doc_name, file_path) VALUES ($1, $2, $3);`;
                    await client.query(docQuery, [newTask.task_id, doc.name, doc.filePath]);
                }
            }
        }
        
        await client.query('COMMIT');
        return findById(newTask.task_id);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const findById = async (taskId) => {
    const taskQuery = `SELECT * FROM tasks WHERE task_id = $1`;
    const taskResult = await db.query(taskQuery, [taskId]);
    const task = taskResult.rows[0];

    if (!task) {
        return null;
    }

    const orgsQuery = `SELECT org_id FROM task_assigned_orgs WHERE task_id = $1`;
    const trackersQuery = `SELECT user_id FROM task_trackers WHERE task_id = $1`;
    const docsQuery = `SELECT doc_id, doc_name, file_path FROM task_documents WHERE task_id = $1 ORDER BY doc_id`;

    const [orgsResult, trackersResult, docsResult] = await Promise.all([
        db.query(orgsQuery, [taskId]),
        db.query(trackersQuery, [taskId]),
        db.query(docsQuery, [taskId]),
    ]);

    task.assignedOrgIds = orgsResult.rows.map(r => r.org_id);
    task.trackerIds = trackersResult.rows.map(r => r.user_id);
    task.documents = docsResult.rows;

    return task;
};

const update = async (taskId, taskData) => {
     const { 
        title, description, document_ref, is_direct_assignment, 
        due_date, priority, assignedOrgIds, trackerIds, documents 
    } = taskData;

    const client = await db.getClient();
    let docsToDelete = [];
    try {
        await client.query('BEGIN');
        
        const taskQuery = `
            UPDATE tasks SET
                title = $1, description = $2, priority = $3, document_ref = $4,
                is_direct_assignment = $5, due_date = $6, updated_at = CURRENT_TIMESTAMP
            WHERE task_id = $7 RETURNING *;
        `;
        await client.query(taskQuery, [title, description, priority, document_ref, is_direct_assignment, due_date || null, taskId]);

        await client.query('DELETE FROM task_assigned_orgs WHERE task_id = $1', [taskId]);
        if (assignedOrgIds && assignedOrgIds.length > 0) {
            const orgValues = assignedOrgIds.map(orgId => `(${taskId}, ${orgId})`).join(', ');
            await client.query(`INSERT INTO task_assigned_orgs (task_id, org_id) VALUES ${orgValues};`);
        }

        await client.query('DELETE FROM task_trackers WHERE task_id = $1', [taskId]);
        if (trackerIds && trackerIds.length > 0) {
            const trackerValues = trackerIds.map(userId => `(${taskId}, ${userId})`).join(', ');
            await client.query(`INSERT INTO task_trackers (task_id, user_id) VALUES ${trackerValues};`);
        }

        const oldDocsQuery = `SELECT file_path FROM task_documents WHERE task_id = $1 AND file_path IS NOT NULL`;
        const { rows: oldDocs } = await client.query(oldDocsQuery, [taskId]);
        docsToDelete = oldDocs;

        await client.query('DELETE FROM task_documents WHERE task_id = $1', [taskId]);
         if (documents && documents.length > 0) {
             for (const doc of documents) {
                if (doc.name && doc.filePath) {
                    const docQuery = `INSERT INTO task_documents (task_id, doc_name, file_path) VALUES ($1, $2, $3);`;
                    await client.query(docQuery, [taskId, doc.name, doc.filePath]);
                }
            }
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    if (docsToDelete.length > 0) {
        console.log(`[Storage] Deleting ${docsToDelete.length} old files for updated task ${taskId}...`);
        const deletePromises = docsToDelete.map(doc => storageService.deleteFile(doc.file_path));
        await Promise.all(deletePromises).catch(err => console.error("[Storage] Error during old task file cleanup:", err));
    }

    return findById(taskId);
};

const remove = async (taskId) => {
    const docsQuery = `SELECT file_path FROM task_documents WHERE task_id = $1 AND file_path IS NOT NULL`;
    const { rows: documentsToDelete } = await db.query(docsQuery, [taskId]);

    const { rows } = await db.query('DELETE FROM tasks WHERE task_id = $1 RETURNING *', [taskId]);
    const deletedTask = rows[0];

    if (deletedTask && documentsToDelete.length > 0) {
        console.log(`[Storage] Deleting ${documentsToDelete.length} files for deleted task ${taskId}...`);
        const deletePromises = documentsToDelete.map(doc => storageService.deleteFile(doc.file_path));
        await Promise.all(deletePromises);
    }
    return deletedTask;
};

const findAll = async (user, filters) => {
    const { dynamicStatus, orgId, searchTerm } = filters;

    let mainQuery = `
        SELECT
            t.task_id, t.title, t.status, t.priority, t.due_date, t.completed_at, t.created_at,
            u.full_name as creator_name
        FROM tasks t
        LEFT JOIN users u ON t.creator_id = u.user_id
    `;
    const whereClauses = [];
    const params = [];
    let paramIndex = 1;

    if (user.role !== 'Admin') {
        whereClauses.push(`(
            t.creator_id = $${paramIndex}
            OR t.task_id IN (SELECT task_id FROM task_trackers WHERE user_id = $${paramIndex})
        )`);
        params.push(user.user_id);
        paramIndex++;
    }

    if (dynamicStatus) {
        let dynamicStatusArray = Array.isArray(dynamicStatus) ? dynamicStatus : String(dynamicStatus).split(',').map(s => s.trim());
        const statusConditions = [];
        
        dynamicStatusArray.forEach(statusItem => {
            switch (statusItem) {
                case 'on_time': statusConditions.push(`(t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date >= CURRENT_DATE)`); break;
                case 'overdue': statusConditions.push(`(t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)`); break;
                case 'completed_on_time': statusConditions.push(`(t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at <= t.due_date)`); break;
                case 'completed_late': statusConditions.push(`(t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at > t.due_date)`); break;
                default:
                    statusConditions.push(`t.status = $${paramIndex}`);
                    params.push(statusItem);
                    paramIndex++;
                    break;
            }
        });

        if (statusConditions.length > 0) {
            whereClauses.push(`(${statusConditions.join(' OR ')})`);
        }
    }

    if (orgId) {
        whereClauses.push(`t.task_id IN (SELECT task_id FROM task_assigned_orgs WHERE org_id = $${paramIndex})`);
        params.push(orgId);
        paramIndex++;
    }

    // [CẬP NHẬT] Thêm logic lọc theo tên công việc
    if (searchTerm) {
        whereClauses.push(`t.title ILIKE $${paramIndex}`);
        params.push(`%${searchTerm}%`);
        paramIndex++;
    }

    if (whereClauses.length > 0) {
        mainQuery += ' WHERE ' + whereClauses.join(' AND ');
    }

    mainQuery += ' ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC';

    const { rows: tasks } = await db.query(mainQuery, params);
    if (tasks.length === 0) {
        return [];
    }
    const taskIds = tasks.map(t => t.task_id);

    const orgsQuery = `
        SELECT tao.task_id, o.org_id, o.org_name
        FROM task_assigned_orgs tao
        JOIN organizations o ON tao.org_id = o.org_id
        WHERE tao.task_id = ANY($1::int[]);
    `;
    const trackersQuery = `
        SELECT tt.task_id, u.user_id, u.full_name
        FROM task_trackers tt
        JOIN users u ON tt.user_id = u.user_id
        WHERE tt.task_id = ANY($1::int[]);
    `;

    const [orgsResult, trackersResult] = await Promise.all([
        db.query(orgsQuery, [taskIds]),
        db.query(trackersQuery, [taskIds]),
    ]);

    const orgsMap = new Map();
    orgsResult.rows.forEach(row => {
        if (!orgsMap.has(row.task_id)) orgsMap.set(row.task_id, []);
        orgsMap.get(row.task_id).push({ org_id: row.org_id, org_name: row.org_name });
    });

    const trackersMap = new Map();
    trackersResult.rows.forEach(row => {
        if (!trackersMap.has(row.task_id)) trackersMap.set(row.task_id, []);
        trackersMap.get(row.task_id).push({ user_id: row.user_id, full_name: row.full_name });
    });

    tasks.forEach(task => {
        task.assigned_orgs = orgsMap.get(task.task_id) || [];
        task.trackers = trackersMap.get(task.task_id) || [];
    });

    return tasks;
};

const updateStatus = async (taskId, status, completed_at = null) => {
    const query = `
        UPDATE tasks SET status = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP
        WHERE task_id = $3 RETURNING *;
    `;
    const { rows } = await db.query(query, [status, completed_at, taskId]);
    return rows[0];
};

const getTasksSummary = async (user) => {
    let baseQuery = `
        FROM tasks t
    `;
    let userJoins = '';
    let userWhereClause = '';
    const params = [];

    if (user.role !== 'Admin') {
        userJoins = `
            LEFT JOIN task_trackers tt ON t.task_id = tt.task_id
        `;
        userWhereClause = `AND (t.creator_id = $1 OR tt.user_id = $1)`;
        params.push(user.user_id);
    }

    const finalQuery = `
        SELECT 
            COUNT(DISTINCT t.task_id) FILTER (WHERE t.due_date < CURRENT_TIMESTAMP AND t.status != 'completed' ${userWhereClause}) AS overdue_tasks,
            COUNT(DISTINCT t.task_id) FILTER (WHERE (t.due_date >= CURRENT_TIMESTAMP OR t.due_date IS NULL) AND t.status != 'completed' ${userWhereClause}) AS ongoing_tasks
        ${baseQuery}
        ${userJoins}
    `;

    try {
        const { rows } = await db.query(finalQuery, params);
        const { overdue_tasks, ongoing_tasks } = rows[0];

        return {
            overdueTasks: parseInt(overdue_tasks, 10),
            ongoingTasks: parseInt(ongoing_tasks, 10)
        };
    } catch (error) {
        console.error("Lỗi khi lấy tóm tắt công việc:", error);
        return {
            overdueTasks: 0,
            ongoingTasks: 0
        };
    }
};


module.exports = {
    create,
    findAll,
    findById,
    update,
    updateStatus,
    remove,
    getTasksSummary,
};