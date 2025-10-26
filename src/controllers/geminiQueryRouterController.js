const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const { normalizeText, checkAnchorKeyword } = require('../config/keywordCache');
const { TaskType } = require('@google/generative-ai');

const SIMILARITY_THRESHOLD = 0.75; // Ngưỡng tương đồng ngữ nghĩa

const routeQuery = async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ message: 'Prompt is required.' });
    }

    try {
        // Chuẩn hóa prompt để kiểm tra từ khóa
        const normalizedPrompt = normalizeText(prompt);

        // --- Filter 1: Kiểm tra từ khóa neo (Anchor Keyword Check) ---
        if (checkAnchorKeyword(normalizedPrompt)) {
            console.log(`[Query Router] Decision: ACTIVATE_RAG (Reason: Anchor Keyword Match)`);
            return res.json({ "decision": "ACTIVATE_RAG", "reason": "anchor_keyword_match" });
        }

        // --- Filter 2: Kiểm tra ngữ nghĩa (Semantic Check) ---
        // Tạo embedding cho prompt
        const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);

        // Lấy điểm tương đồng của vector khớp nhất
        const topMatch = await knowledgeModel.getTopVectorMatch(promptEmbedding);

        if (topMatch && topMatch.similarity_score >= SIMILARITY_THRESHOLD) {
            console.log(`[Query Router] Decision: ACTIVATE_RAG (Reason: Semantic Score Match, Score: ${topMatch.similarity_score.toFixed(4)})`);
            return res.json({ "decision": "ACTIVATE_RAG", "reason": "semantic_score_match" });
        }

        // --- Fallback: Nếu cả hai filter đều không khớp ---
        const reason = topMatch
            ? `low_similarity_score (Score: ${topMatch.similarity_score.toFixed(4)})`
            : "no_similar_vectors_found";
        console.log(`[Query Router] Decision: DIRECT_FALLBACK (Reason: ${reason})`);
        return res.json({ "decision": "DIRECT_FALLBACK", "reason": reason });

    } catch (error) {
        console.error('[Query Router] Lỗi trong quá trình định tuyến truy vấn:', error);
        // Nếu có bất kỳ lỗi nào (ví dụ: không thể tạo embedding), luôn fallback để đảm bảo hệ thống không bị gián đoạn
        console.log(`[Query Router] Decision: DIRECT_FALLBACK (Reason: Error during routing)`);
        return res.json({ "decision": "DIRECT_FALLBACK", "reason": "error_during_routing" });
    }
};

module.exports = {
    routeQuery,
};