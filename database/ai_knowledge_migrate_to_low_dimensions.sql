-- Migrate ai_knowledge sang embedding dimensions thấp hơn để hỗ trợ ANN index
-- Mục tiêu: giảm từ 3072 xuống <= 2000 (khuyến nghị 1536)
-- LƯU Ý: script này sẽ xóa dữ liệu vector hiện tại trong ai_knowledge.

BEGIN;

-- 1) Xóa toàn bộ dữ liệu tri thức cũ (vì embedding dimension thay đổi)
TRUNCATE TABLE ai_knowledge RESTART IDENTITY;

-- 2) Đổi kiểu cột embedding sang vector(1536)
-- Nếu bạn dùng chiều khác, sửa 1536 tương ứng (ví dụ 1024)
ALTER TABLE ai_knowledge
ALTER COLUMN embedding TYPE vector(1536);

COMMIT;

-- 3) Tạo lại index hybrid (full-text + ivfflat)
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_search_tsv
ON ai_knowledge
USING GIN (
    to_tsvector('simple', COALESCE(content, '') || ' ' || COALESCE(source_document, ''))
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_embedding_ivfflat
ON ai_knowledge
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

ANALYZE ai_knowledge;
