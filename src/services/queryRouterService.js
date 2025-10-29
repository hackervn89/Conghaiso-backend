const aiService = require('./aiService');
const knowledgeModel = require('../models/knowledgeModel');
const { normalizeText, checkAnchorKeyword } = require('../config/keywordCache'); // [FIX] Import lại checkAnchorKeyword
const { TaskType } = require('@google/generative-ai');

const SIMILARITY_THRESHOLD = 0.75; // Ngưỡng tương đồng ngữ nghĩa

/**
 * Phân tích prompt và quyết định hành động tiếp theo cho AI.
 * @param {string} prompt - Câu hỏi gốc của người dùng.
 * @returns {Promise<{decision: string, reason: string}>} - Quyết định ('USE_INTERNAL_TOOLS', 'USE_EXTERNAL_TOOLS') và lý do.
 */
async function routeQuery(prompt) {
    try {
        const normalizedPrompt = normalizeText(prompt);

        // --- [FIX] Filter 1: Khôi phục lại logic kiểm tra từ khóa neo ---
        if (checkAnchorKeyword(normalizedPrompt)) {
            console.log(`[Query Router] Decision: USE_INTERNAL_TOOLS (Reason: Anchor Keyword Match)`);
            return { decision: "USE_INTERNAL_TOOLS", reason: "anchor_keyword_match" };
        }

        // --- Kiểm tra ngữ nghĩa để xem có nên sử dụng các công cụ nội bộ (RAG, CSDL) không ---
        const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);
        const topMatch = await knowledgeModel.getTopVectorMatch(promptEmbedding);

        if (topMatch && topMatch.similarity_score >= SIMILARITY_THRESHOLD) {
            // Nếu câu hỏi có vẻ liên quan đến kiến thức nội bộ, cho phép AI sử dụng tất cả các công cụ.
            console.log(`[Query Router] Decision: USE_INTERNAL_TOOLS (Reason: Semantic Score Match, Score: ${topMatch.similarity_score.toFixed(4)})`);
            return { decision: "USE_INTERNAL_TOOLS", reason: "semantic_score_match" };
        }

        // Nếu không, chỉ cho phép AI sử dụng các công cụ CSDL và Google Search, không tìm trong kho tri thức.
        console.log(`[Query Router] Decision: USE_EXTERNAL_TOOLS (Reason: No RAG match)`);
        return { decision: "USE_EXTERNAL_TOOLS", reason: "no_rag_match" };

    } catch (error) {
        console.error('[Query Router] Lỗi trong quá trình định tuyến, sẽ fallback:', error);
        return { decision: "USE_EXTERNAL_TOOLS", reason: "error_during_routing" };
    }
}

module.exports = { routeQuery };