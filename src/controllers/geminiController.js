const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const { TaskType } = require('@google/generative-ai');
const axios = require('axios');

const chatWithAI = async (req, res) => {
    try {
        const { prompt, history = [] } = req.body;
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }

        // --- Bước 1: Gọi đến "Bộ điều hướng" để lấy quyết định ---
        const routerUrl = `${req.protocol}://${req.get('host')}/api/router/route-query`;
        const routerResponse = await axios.post(
            routerUrl,
            { prompt },
            { headers: { 'Authorization': req.headers.authorization } } // Chuyển tiếp token xác thực
        );
        const { decision } = routerResponse.data;

        let augmentedPrompt;
        const systemPrompt = `Bạn là trợ lý ảo chuyên nghiệp của "Công Hải Số".`;

        // --- Bước 2: Xây dựng prompt dựa trên quyết định của router ---
        if (decision === 'ACTIVATE_RAG') {
            console.log('[AI Chat] Kích hoạt RAG dựa trên quyết định của router.');
            // 2.1. Tạo embedding cho câu hỏi
            const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);

            // 2.2. Tìm các chunks tương tự
            const similarChunks = await knowledgeModel.findSimilar(promptEmbedding, 5); // Lấy 5 chunks liên quan nhất

            // 2.3. Xây dựng context và prompt cuối cùng
            const context = similarChunks.map(chunk => chunk.content).join('\n\n---\n\n');
            augmentedPrompt = `Hãy phân tích tài liệu và câu hỏi dưới đây.
--- BẮT ĐẦU TÀI LIỆU ---
${context}
--- KẾT THÚC TÀI LIỆU ---
Câu hỏi của người dùng: "${prompt}"
---
Chỉ dẫn:
1. Nếu câu hỏi của người dùng có liên quan đến nội dung trong "TÀI LIỆU", hãy dựa vào tài liệu và kiến thức của bạn để trả lời câu hỏi một cách chính xác.
2. Nếu câu hỏi và tài liệu không liên quan đến nhau, hãy bỏ qua tài liệu và trả lời câu hỏi dựa trên kiến thức chung của bạn, đồng thời sử dụng công cụ tìm kiếm Google Search để có thông tin mới nhất và phân tích để trả lời. Lưu ý, bạn không cần phân tích ra sự có liên quan hay không liên quan giữa câu hỏi và tài liệu, Bạn chỉ cần trả lời câu hỏi là được`;

        } else { // decision === 'DIRECT_FALLBACK'
            console.log('[AI Chat] Sử dụng Fallback (kiến thức chung & Google Search) dựa trên quyết định của router.');
            // 2.1. Xây dựng prompt đơn giản
            augmentedPrompt = `Câu hỏi của người dùng: "${prompt}"
---
Chỉ dẫn:
Hãy trả lời câu hỏi của người dùng dựa trên kiến thức chung của bạn và sử dụng công cụ tìm kiếm Google Search để có thông tin mới nhất.`;
        }

        // --- Bước 3: Generate - Xây dựng history và gọi Gemini ---
        const finalHistory = [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Vâng, tôi đã hiểu. Tôi là trợ lý ảo của Công Hải Số. Tôi đã sẵn sàng trả lời các câu hỏi." }] },
            ...history // Thêm lịch sử chat cũ nếu có
        ];

        const reply = await aiService.generateChatResponse(augmentedPrompt, finalHistory);

        res.status(200).json({ reply });

    } catch (error) {
        console.error('Error in chatWithAI:', error);
        if (error.isAxiosError) {
            console.error('Axios error detail:', error.response?.data);
            return res.status(500).json({ message: 'Lỗi giao tiếp nội bộ với AI Query Router.' });
        }
        if (error.message.includes("embedding") || error.message.includes("AI service")) {
            return res.status(503).json({ message: 'AI service is currently unavailable. Please try again later.' });
        }
        res.status(500).json({ message: 'Server error while processing chat request.' });
    }
};

module.exports = {
    chatWithAI,
};