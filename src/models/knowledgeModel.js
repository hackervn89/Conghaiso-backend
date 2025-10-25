const db = require('../config/database');
const pgvector = require('pgvector/pg');

const create = async (data) => {
    const { content, category, source_document, embedding } = data;
    const query = `
        INSERT INTO ai_knowledge (content, category, source_document, embedding)
        VALUES ($1, $2, $3, $4)
        RETURNING id, content, category, source_document, created_at;
    `;
    const params = [content, category, source_document, pgvector.toSql(embedding)];
    const { rows } = await db.query(query, params);
    return rows[0];
};

const update = async (id, data) => {
    const { content, category, source_document, embedding } = data;
    const query = `
        UPDATE ai_knowledge
        SET content = $1, category = $2, source_document = $3, embedding = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING id, content, category, source_document, updated_at;
    `;
    const params = [content, category, source_document, pgvector.toSql(embedding), id];
    const { rows } = await db.query(query, params);
    return rows[0];
};

const remove = async (id) => {
    await db.query('DELETE FROM ai_knowledge WHERE id = $1', [id]);
};

const findAll = async (page = 1, limit = 10) => {
    const offset = (page - 1) * limit;
    const countQuery = 'SELECT COUNT(*) FROM ai_knowledge';
    const dataQuery = `
        SELECT id, content, category, source_document, created_at, updated_at
        FROM ai_knowledge
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2;
    `;

    const [countResult, dataResult] = await Promise.all([
        db.query(countQuery),
        db.query(dataQuery, [limit, offset])
    ]);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    return {
        knowledge: dataResult.rows,
        page: page,
        pages: totalPages,
        total: totalItems
    };
};

const findById = async (id) => {
    const query = 'SELECT id, content, category, source_document FROM ai_knowledge WHERE id = $1';
    const { rows } = await db.query(query, [id]);
    return rows[0];
};

const findSimilar = async (embedding, limit = 10) => {
    // [UPDATE] Cập nhật truy vấn để lấy cả điểm khoảng cách (distance)
    const query = `
        SELECT content, embedding <=> $1 AS distance
        FROM ai_knowledge 
        ORDER BY distance ASC 
        LIMIT $2`;
    const { rows } = await db.query(query, [pgvector.toSql(embedding), limit]);
    return rows; // Trả về toàn bộ các dòng (bao gồm cả content và distance)
};

module.exports = {
    create,
    update,
    remove,
    findAll,
    findById,
    findSimilar,
};