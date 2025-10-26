const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const { TaskType } = require('@google/generative-ai');

const chatWithAI = async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }

        // 1. Embedding: Tạo vector cho câu hỏi của người dùng
        // Sử dụng TaskType.RETRIEVAL_QUERY để tối ưu cho việc tìm kiếm
        const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);

        // 2. Retrieval: Tìm kiếm các đoạn văn bản tương tự trong CSDL
        const similarChunks = await knowledgeModel.findSimilar(promptEmbedding, 3); // Giờ sẽ trả về [{ content, distance }, ...]

        // [LOGGING] Thêm log để xem các chunk được tìm thấy và gửi đi
        console.log(`[AI Chat] Found ${similarChunks.length} chunks for prompt: "${prompt}"`);
        if (similarChunks.length > 0) {
            similarChunks.forEach((chunk, index) => {
                console.log(`  - Chunk ${index + 1} (distance: ${chunk.distance.toFixed(4)}):`, chunk.content);
            });
        }

        // 3. Augment: Luôn xây dựng prompt phức tạp theo yêu cầu của bạn
        const context = similarChunks.map(chunk => chunk.content).join('\n\n---\n\n');

        const systemPrompt = `Bạn là trợ lý ảo chuyên nghiệp của "Công Hải Số".`;
        const augmentedPrompt = `Hãy phân tích tài liệu và câu hỏi dưới đây.
--- BẮT ĐẦU TÀI LIỆU ---
${context}
--- KẾT THÚC TÀI LIỆU ---
Câu hỏi của người dùng: "${prompt}"
---
Chỉ dẫn:
1. Nếu câu hỏi của người dùng có liên quan đến nội dung trong "TÀI LIỆU", hãy dựa vào tài liệu và kiến thức của bạn để trả lời câu hỏi một cách chính xác.
2. Nếu câu hỏi và tài liệu không liên quan đến nhau, hãy bỏ qua tài liệu và trả lời câu hỏi dựa trên kiến thức chung của bạn, đồng thời sử dụng công cụ tìm kiếm Google Search để có thông tin mới nhất và phân tích để trả lời. Lưu ý, bạn không cần phân tích ra sự có liên quan hay không liên quan giữa câu hỏi và tài liệu, Bạn chỉ cần trả lời câu hỏi là được`;

        // 4. Generate: Xây dựng history và gọi Gemini
        const history = [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Vâng, tôi đã hiểu. Tôi là trợ lý ảo của Công Hải Số. Tôi đã sẵn sàng trả lời các câu hỏi." }] },
        ];

        const reply = await aiService.generateChatResponse(augmentedPrompt, history);

        res.status(200).json({ reply });

    } catch (error) {
        console.error('Error in chatWithAI:', error);
        if (error.message.includes("embedding") || error.message.includes("chat model")) {
            return res.status(503).json({ message: 'AI service is currently unavailable. Please try again later.' });
        }
        res.status(500).json({ message: 'Server error while processing chat request.' });
    }
};

module.exports = {
    chatWithAI,
};