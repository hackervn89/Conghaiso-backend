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

const createMany = async (rowsToInsert = []) => {
    if (!rowsToInsert.length) return [];

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const created = [];

        for (const row of rowsToInsert) {
            const { content, category, source_document, embedding } = row;
            const query = `
                INSERT INTO ai_knowledge (content, category, source_document, embedding)
                VALUES ($1, $2, $3, $4)
                RETURNING id, content, category, source_document, created_at;
            `;
            const params = [content, category, source_document, pgvector.toSql(embedding)];
            const { rows } = await client.query(query, params);
            created.push(rows[0]);
        }

        await client.query('COMMIT');
        return created;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
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

const removeBySourceDocument = async (sourceDocument) => {
    const query = 'DELETE FROM ai_knowledge WHERE source_document = $1';
    const result = await db.query(query, [sourceDocument]);
    return result.rowCount;
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
        page,
        pages: totalPages,
        total: totalItems
    };
};

const getSourcesSummary = async () => {
    const query = `
        SELECT
            source_document,
            category,
            COUNT(*)::int AS chunk_count,
            MAX(created_at) AS last_ingested_at
        FROM ai_knowledge
        GROUP BY source_document, category
        ORDER BY last_ingested_at DESC NULLS LAST, source_document ASC;
    `;
    const { rows } = await db.query(query);
    return rows;
};

const findById = async (id) => {
    const query = 'SELECT id, content, category, source_document FROM ai_knowledge WHERE id = $1';
    const { rows } = await db.query(query, [id]);
    return rows[0];
};

const findSimilar = async (embedding, limit = 10) => {
    const query = `
        SELECT content, embedding <=> $1 AS distance
        FROM ai_knowledge 
        ORDER BY distance ASC 
        LIMIT $2`;
    const { rows } = await db.query(query, [pgvector.toSql(embedding), limit]);
    return rows;
};

const getTopVectorMatch = async (embedding) => {
    const query = `
        SELECT 1 - (embedding <=> $1) AS similarity_score
        FROM ai_knowledge
        ORDER BY embedding <=> $1
        LIMIT 1;
    `;
    const { rows } = await db.query(query, [pgvector.toSql(embedding)]);
    return rows[0] || null;
};

module.exports = {
    create,
    createMany,
    update,
    remove,
    removeBySourceDocument,
    findAll,
    getSourcesSummary,
    findById,
    findSimilar,
    getTopVectorMatch,
};
