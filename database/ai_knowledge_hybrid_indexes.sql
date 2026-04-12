-- Chỉ mục khuyến nghị cho Hybrid Retrieval (Vector + Keyword)
-- Bản này đã điều chỉnh để tương thích tốt hơn với PostgreSQL + pgvector
-- đang dùng embedding 3072 dimensions.

-- =====================================================
-- 1) Full-text index
-- Lưu ý: không dùng CONCAT_WS trong index expression vì dễ gặp lỗi
-- "functions in index expression must be marked IMMUTABLE".
-- Dùng phép nối chuỗi thuần + COALESCE an toàn hơn.
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_search_tsv
ON ai_knowledge
USING GIN (
    to_tsvector('simple', COALESCE(content, '') || ' ' || COALESCE(source_document, ''))
);

-- =====================================================
-- 2) Vector index
-- HNSW không dùng được với vector 3072 dimensions trên môi trường hiện tại
-- vì pgvector báo lỗi: "column cannot have more than 2000 dimensions for hnsw index"
-- => dùng IVFFLAT thay thế.
--
-- Lưu ý:
-- - Nên chạy ANALYZE sau khi tạo index
-- - IVFFLAT hoạt động tốt hơn khi bảng đã có đủ dữ liệu
-- - Có thể điều chỉnh lists = 100 / 200 / 500 theo quy mô dữ liệu
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_embedding_ivfflat
ON ai_knowledge
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

ANALYZE ai_knowledge;
