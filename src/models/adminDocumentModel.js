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
            file_name = COALESCE(EXCLUDED.file_name, admin_documents.file_name),
            file_path = COALESCE(EXCLUDED.file_path, admin_documents.file_path),
            file_url = COALESCE(EXCLUDED.file_url, admin_documents.file_url),
            symbol = EXCLUDED.symbol,
            doc_type = EXCLUDED.doc_type,
            issued_date = EXCLUDED.issued_date,
            issuer = EXCLUDED.issuer,
            summary = EXCLUDED.summary,
            abstract = EXCLUDED.abstract,
            keywords = EXCLUDED.keywords,
            ocr_status = COALESCE(EXCLUDED.ocr_status, admin_documents.ocr_status),
            ingest_status = COALESCE(EXCLUDED.ingest_status, admin_documents.ingest_status),
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

const findAll = async ({
    page = 1,
    limit = 20,
    docType = null,
    search = '',
    ingestStatus = null,
    ocrStatus = null,
    hasFile = null,
} = {}) => {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (docType) {
        params.push(docType);
        conditions.push(`doc_type = $${params.length}`);
    }

    if (ingestStatus) {
        params.push(ingestStatus);
        conditions.push(`ingest_status = $${params.length}`);
    }

    if (ocrStatus) {
        params.push(ocrStatus);
        conditions.push(`ocr_status = $${params.length}`);
    }

    if (typeof hasFile === 'boolean') {
        conditions.push(hasFile ? `file_path IS NOT NULL` : `file_path IS NULL`);
    }

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(
            document_code ILIKE $${params.length}
            OR COALESCE(symbol, '') ILIKE $${params.length}
            OR COALESCE(summary, '') ILIKE $${params.length}
            OR COALESCE(abstract, '') ILIKE $${params.length}
            OR COALESCE(file_name, '') ILIKE $${params.length}
            OR COALESCE(issuer, '') ILIKE $${params.length}
        )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) FROM admin_documents ${whereClause}`;
    params.push(limit, offset);
    const dataQuery = `
        SELECT *
        FROM admin_documents
        ${whereClause}
        ORDER BY issued_date DESC NULLS LAST, updated_at DESC, created_at DESC
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

const updateFileInfo = async (documentCode, { file_name, file_path, file_url, ocr_status = null, ingest_status = null, last_error = null }) => {
    const query = `
        UPDATE admin_documents
        SET file_name = $2,
            file_path = $3,
            file_url = $4,
            ocr_status = COALESCE($5, ocr_status),
            ingest_status = COALESCE($6, ingest_status),
            last_error = $7,
            updated_at = CURRENT_TIMESTAMP
        WHERE document_code = $1
        RETURNING *;
    `;

    const { rows } = await db.query(query, [documentCode, file_name, file_path, file_url, ocr_status, ingest_status, last_error]);
    return rows[0] || null;
};

const updateStatuses = async (documentCode, { ocr_status = null, ingest_status = null, last_error = null }) => {
    const query = `
        UPDATE admin_documents
        SET ocr_status = COALESCE($2, ocr_status),
            ingest_status = COALESCE($3, ingest_status),
            last_error = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE document_code = $1
        RETURNING *;
    `;

    const { rows } = await db.query(query, [documentCode, ocr_status, ingest_status, last_error]);
    return rows[0] || null;
};

const updateIngestStatus = async (documentCode, ingestStatus, lastError = null) => {
    return updateStatuses(documentCode, {
        ingest_status: ingestStatus,
        last_error: lastError,
    });
};

const getStats = async () => {
    const query = `
        SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE file_path IS NOT NULL)::int AS with_file,
            COUNT(*) FILTER (WHERE file_path IS NULL)::int AS without_file,
            COUNT(*) FILTER (WHERE ingest_status = 'ingested')::int AS ingested,
            COUNT(*) FILTER (WHERE ingest_status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE ingest_status = 'processing')::int AS processing,
            COUNT(*) FILTER (WHERE ocr_status = 'done')::int AS ocr_done,
            COUNT(*) FILTER (WHERE ocr_status = 'required')::int AS ocr_required
        FROM admin_documents;
    `;

    const { rows } = await db.query(query);
    return rows[0];
};

const getDocTypes = async () => {
    const query = `
        SELECT DISTINCT doc_type
        FROM admin_documents
        WHERE doc_type IS NOT NULL AND TRIM(doc_type) <> ''
        ORDER BY doc_type ASC;
    `;

    const { rows } = await db.query(query);
    return rows.map((row) => row.doc_type);
};

module.exports = {
    upsert,
    findAll,
    findByCode,
    updateFileInfo,
    updateStatuses,
    updateIngestStatus,
    getStats,
    getDocTypes,
};
