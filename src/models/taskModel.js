const db = require('../config/database');

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
                const docQuery = `INSERT INTO task_documents (task_id, doc_name, google_drive_file_id) VALUES ($1, $2, $3);`;
                await client.query(docQuery, [newTask.task_id, doc.doc_name, doc.google_drive_file_id]);
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

const findAll = async (user, filters) => {
    // [CẬP NHẬT] Thay `status` bằng `dynamicStatus`
    const { dynamicStatus, orgId } = filters;

    let query = `
        SELECT
            t.task_id, t.title, t.status, t.priority, t.due_date, t.completed_at, t.created_at,
            (SELECT u.full_name FROM users u WHERE u.user_id = t.creator_id) as creator_name,
            (SELECT json_agg(json_build_object('org_id', o.org_id, 'org_name', o.org_name))
             FROM task_assigned_orgs tao JOIN organizations o ON tao.org_id = o.org_id
             WHERE tao.task_id = t.task_id) as assigned_orgs,
            (SELECT json_agg(json_build_object('user_id', u.user_id, 'full_name', u.full_name))
             FROM task_trackers tt JOIN users u ON tt.user_id = u.user_id
             WHERE tt.task_id = t.task_id) as trackers
        FROM tasks t
    `;

    const whereClauses = [];
    const params = [];

    if (user.role !== 'Admin') {
        const userParamIndex = `$${params.length + 1}`;
        whereClauses.push(`(
            t.creator_id = ${userParamIndex}
            OR t.task_id IN (SELECT task_id FROM task_trackers WHERE user_id = ${userParamIndex})
            OR t.task_id IN (
                SELECT tao.task_id FROM task_assigned_orgs tao
                JOIN user_organizations uo ON tao.org_id = uo.org_id
                WHERE uo.user_id = ${userParamIndex}
            )
        )`);
        params.push(user.user_id);
    }
    
    // [CẬP NHẬT] Logic lọc theo trạng thái động
    if (dynamicStatus) {
        switch (dynamicStatus) {
            case 'on_time':
                whereClauses.push(`t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date >= CURRENT_DATE`);
                break;
            case 'overdue':
                whereClauses.push(`t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE`);
                break;
            case 'completed_on_time':
                whereClauses.push(`t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at <= t.due_date`);
                break;
            case 'completed_late':
                whereClauses.push(`t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at > t.due_date`);
                break;
        }
    }


    if (orgId) {
        whereClauses.push(`t.task_id IN (SELECT task_id FROM task_assigned_orgs WHERE org_id = $${params.length + 1})`);
        params.push(orgId);
    }

    if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
    }

    query += ' ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC';
    
    const { rows } = await db.query(query, params);
    return rows;
};


const findById = async (taskId) => {
    const query = `
        SELECT 
            t.*,
            (SELECT COALESCE(json_agg(tao.org_id), '[]'::json) FROM task_assigned_orgs tao WHERE tao.task_id = t.task_id) as "assignedOrgIds",
            (SELECT COALESCE(json_agg(tt.user_id), '[]'::json) FROM task_trackers tt WHERE tt.task_id = t.task_id) as "trackerIds",
            (SELECT COALESCE(json_agg(json_build_object('doc_id', td.doc_id, 'doc_name', td.doc_name, 'google_drive_file_id', td.google_drive_file_id)), '[]'::json)
             FROM task_documents td WHERE td.task_id = t.task_id) as documents
        FROM tasks t
        WHERE t.task_id = $1;
    `;
    const { rows } = await db.query(query, [taskId]);
    return rows[0];
};

const update = async (taskId, taskData) => {
     const { 
        title, description, document_ref, is_direct_assignment, 
        due_date, priority, assignedOrgIds, trackerIds, documents 
    } = taskData;

    const client = await db.getClient();
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

        await client.query('DELETE FROM task_documents WHERE task_id = $1', [taskId]);
         if (documents && documents.length > 0) {
             for (const doc of documents) {
                const docQuery = `INSERT INTO task_documents (task_id, doc_name, google_drive_file_id) VALUES ($1, $2, $3);`;
                await client.query(docQuery, [taskId, doc.doc_name, doc.google_drive_file_id]);
            }
        }

        await client.query('COMMIT');
        return findById(taskId);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const updateStatus = async (taskId, status, completed_at = null) => {
    const query = `
        UPDATE tasks SET status = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP
        WHERE task_id = $3 RETURNING *;
    `;
    const { rows } = await db.query(query, [status, completed_at, taskId]);
    return rows[0];
};

const remove = async (taskId) => {
    const { rows } = await db.query('DELETE FROM tasks WHERE task_id = $1 RETURNING *', [taskId]);
    return rows[0];
};

const getTasksSummary = async (user) => {
    let query = `
        SELECT COUNT(DISTINCT t.task_id)
        FROM tasks t
    `;
    const params = [];
    let whereClauses = [`t.due_date < CURRENT_TIMESTAMP`, `t.status != 'completed'`];

    if (user.role !== 'Admin') {
        query += `
            LEFT JOIN task_assigned_orgs tao ON t.task_id = tao.task_id
            LEFT JOIN task_trackers tt ON t.task_id = tt.task_id
            LEFT JOIN user_organizations uo ON tao.org_id = uo.org_id
        `;
        whereClauses.push(`(t.creator_id = $1 OR tt.user_id = $1 OR uo.user_id = $1)`);
        params.push(user.user_id);
    }

    if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
    }

    const { rows } = await db.query(query, params);
    return parseInt(rows[0].count, 10);
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

