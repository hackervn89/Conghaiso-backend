const db = require('../config/database');
const crypto = require('crypto');

const create = async (draftData, fileInfo, creatorId) => {
    const { title, document_number, participants, deadline } = draftData;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const draftQuery = `
            INSERT INTO draft_documents (title, document_number, file_name, file_path, creator_id, deadline, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'dang_lay_y_kien')
            RETURNING id, title, creator_id, deadline, created_at;
        `;
        const draftResult = await client.query(draftQuery, [title, document_number, fileInfo.fileName, fileInfo.filePath, creatorId, deadline]);
        const newDraft = draftResult.rows[0];

        if (participants && participants.length > 0) {
            const participantValues = participants.map(pId => `(${newDraft.id}, ${pId})`).join(',');
            const participantQuery = `INSERT INTO draft_participants (draft_id, user_id) VALUES ${participantValues};`;
            await client.query(participantQuery);
        }

        await client.query('COMMIT');
        return newDraft;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const findAllForUser = async (userId) => {
    const query = `
        SELECT
            dd.id,
            dd.title,
            u.full_name AS creator_name,
            dd.deadline,
            dd.status,
            dp.status AS participant_status
        FROM draft_documents dd
        JOIN users u ON dd.creator_id = u.user_id
        LEFT JOIN draft_participants dp ON dd.id = dp.draft_id AND dp.user_id = $1
        WHERE dd.creator_id = $1 OR dp.user_id = $1
        ORDER BY dd.created_at DESC;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
};

const findById = async (id, userId) => {
    // First, check for access
    const accessCheckQuery = `
        SELECT 1 FROM draft_documents dd
        LEFT JOIN draft_participants dp ON dd.id = dp.draft_id
        WHERE dd.id = $1 AND (dd.creator_id = $2 OR dp.user_id = $2)
    `;
    const accessResult = await db.query(accessCheckQuery, [id, userId]);
    if (accessResult.rows.length === 0) {
        return null; // No access
    }

    // Fetch draft details
    const draftQuery = `
        SELECT
            dd.id,
            dd.title,
            dd.file_name,
            dd.file_path,
            u.full_name AS creator_name,
            dd.creator_id,
            dd.deadline,
            dd.status
        FROM draft_documents dd
        JOIN users u ON dd.creator_id = u.user_id
        WHERE dd.id = $1;
    `;
    const draftResult = await db.query(draftQuery, [id]);
    if (draftResult.rows.length === 0) {
        return null; // Not found, though access check should have caught this
    }
    const draft = draftResult.rows[0];

    // Fetch participants
    const participantsQuery = `
        SELECT
            dp.user_id,
            u.full_name,
            dp.status,
            dp.response_at
        FROM draft_participants dp
        JOIN users u ON dp.user_id = u.user_id
        WHERE dp.draft_id = $1
        ORDER BY u.full_name;
    `;
    const participantsResult = await db.query(participantsQuery, [id]);
    draft.participants = participantsResult.rows;

    return draft;
};

const findCommentsByDraftId = async (id) => {
    const query = `
        SELECT
            dc.user_id,
            u.full_name,
            dc.comment,
            dc.created_at
        FROM draft_comments dc
        JOIN users u ON dc.user_id = u.user_id
        WHERE dc.draft_id = $1
        ORDER BY dc.created_at ASC;
    `;
    const { rows } = await db.query(query, [id]);
    return rows;
};

const findParticipant = async (draftId, userId) => {
    const query = `SELECT * FROM draft_participants WHERE draft_id = $1 AND user_id = $2;`;
    const { rows } = await db.query(query, [draftId, userId]);
    return rows[0];
};

const addComment = async (draftId, userId, comment) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const commentQuery = `INSERT INTO draft_comments (draft_id, user_id, comment) VALUES ($1, $2, $3);`;
        await client.query(commentQuery, [draftId, userId, comment]);

        const participantQuery = `
            UPDATE draft_participants
            SET status = 'da_gop_y', response_at = CURRENT_TIMESTAMP
            WHERE draft_id = $1 AND user_id = $2;
        `;
        await client.query(participantQuery, [draftId, userId]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const agree = async (draftId, userId) => {
    const timestamp = Date.now();
    const secretKey = process.env.JWT_SECRET || 'default-secret-key';
    const dataToHash = `${userId}${draftId}${secretKey}${timestamp}`;
    const confirmationHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

    const query = `
        UPDATE draft_participants
        SET status = 'da_thong_nhat', response_at = CURRENT_TIMESTAMP, confirmation_hash = $1
        WHERE draft_id = $2 AND user_id = $3;
    `;
    await db.query(query, [confirmationHash, draftId, userId]);
};

const updateOverdueDrafts = async () => {
    const query = `
        UPDATE draft_documents
        SET status = 'qua_han'
        WHERE status = 'dang_lay_y_kien' AND deadline < NOW()
        RETURNING id, creator_id, title;
    `;
    const { rows } = await db.query(query);
    return rows;
};


module.exports = {
    create,
    findAllForUser,
    findById,
    findCommentsByDraftId,
    findParticipant,
    addComment,
    agree,
    updateOverdueDrafts,
};