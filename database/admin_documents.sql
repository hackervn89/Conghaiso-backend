CREATE TABLE IF NOT EXISTS admin_documents (
    id SERIAL PRIMARY KEY,
    document_code VARCHAR(100) NOT NULL UNIQUE,
    file_name TEXT,
    file_path TEXT,
    file_url TEXT,
    symbol VARCHAR(255),
    doc_type VARCHAR(255),
    issued_date DATE,
    issuer TEXT,
    summary TEXT,
    abstract TEXT,
    keywords TEXT,
    ocr_status VARCHAR(50) DEFAULT 'pending',
    ingest_status VARCHAR(50) DEFAULT 'pending',
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_documents_doc_type ON admin_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_admin_documents_issued_date ON admin_documents(issued_date);
CREATE INDEX IF NOT EXISTS idx_admin_documents_document_code ON admin_documents(document_code);
