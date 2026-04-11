const db = require('../config/database');

const upsert = async (data) => {
    const {
        document_code,
        file_name,
        file_path,
        file_url,
        symbol,
        doc_type,
        issued_date,
        issuer,
        summary,
        abstract,
        keywords,
        ocr_status = 'pending',
        ingest_status = 'pending',
        last_error = null,
    } = data;

    const query = `
        INSERT INTO admin_documents (
            document_code,
            file_name,
            file_path,
            file_url,
            symbol,
            doc_type,
            issued_date,
            issuer,
            summary,
            abstract,
            keywords,
            ocr_status,
            ingest_status,
            last_error
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (document_code)
        DO UPDATE SET
            file_name = EXCLUDED.file_name,
            file_path = EXCLUDED.file_path,
            file_url = EXCLUDED.file_url,
            symbol = EXCLUDED.symbol,
            doc_type = EXCLUDED.doc_type,
            issued_date = EXCLUDED.issued_date,
            issuer = EXCLUDED.issuer,
            summary = EXCLUDED.summary,
            abstract = EXCLUDED.abstract,
            keywords = EXCLUDED.keywords,
            ocr_status = EXCLUDED.ocr_status,
            ingest_status = EXCLUDED.ingest_status,
            last_error = EXCLUDED.last_error,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *;
    `;

    const params = [
        document_code,
        file_name,
        file_path,
        file_url,
        symbol,
        doc_type,
        issued_date,
        issuer,
        summary,
        abstract,
        keywords,
        ocr_status,
        ingest_status,
        last_error,
    ];

    const { rows } = await db.query(query, params);
    return rows[0];
};

const findAll = async ({ page = 1, limit = 20, docType = null, search = '' } = {}) => {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (docType) {
        params.push(docType);
        conditions.push(`doc_type = $${params.length}`);
    }

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(
            document_code ILIKE $${params.length}
            OR COALESCE(symbol, '') ILIKE $${params.length}
            OR COALESCE(summary, '') ILIKE $${params.length}
            OR COALESCE(file_name, '') ILIKE $${params.length}
        )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) FROM admin_documents ${whereClause}`;
    params.push(limit, offset);
    const dataQuery = `
        SELECT *
        FROM admin_documents
        ${whereClause}
        ORDER BY issued_date DESC NULLS LAST, created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length};
    `;

    const [countResult, dataResult] = await Promise.all([
        db.query(countQuery, params.slice(0, params.length - 2)),
        db.query(dataQuery, params),
    ]);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    return {
        documents: dataResult.rows,
        page,
        pages: Math.ceil(totalItems / limit),
        total: totalItems,
    };
};

const findByCode = async (documentCode) => {
    const query = 'SELECT * FROM admin_documents WHERE document_code = $1';
    const { rows } = await db.query(query, [documentCode]);
    return rows[0] || null;
};

const updateIngestStatus = async (documentCode, ingestStatus, lastError = null) => {
    const query = `
        UPDATE admin_documents
        SET ingest_status = $2,
            last_error = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE document_code = $1
        RETURNING *;
    `;
    const { rows } = await db.query(query, [documentCode, ingestStatus, lastError]);
    return rows[0] || null;
};

module.exports = {
    upsert,
    findAll,
    findByCode,
    updateIngestStatus,
};
