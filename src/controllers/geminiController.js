const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const { TaskType } = require('@google/generative-ai');

const chatWithAI = async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }

        // [REFACTOR] Hợp nhất và cải tiến các lớp bảo vệ (Guardrails)
        // Xử lý các câu hỏi quá ngắn hoặc câu chào hỏi chung để tránh thực hiện RAG không cần thiết
        const trimmedPrompt = prompt.trim();
        const greetingKeywords = ['hi', 'hello', 'chào', 'xin chào', 'bạn là ai'];
        if (trimmedPrompt.length < 10 || greetingKeywords.includes(trimmedPrompt.toLowerCase())) {
            const reply = "Xin chào! Tôi là trợ lý ảo của Công Hải Số. Tôi có thể giúp gì cho bạn?";
            return res.status(200).json({ reply });
        }

        // 1. Embedding: Tạo vector cho câu hỏi của người dùng
        // Sử dụng TaskType.RETRIEVAL_QUERY để tối ưu cho việc tìm kiếm
        const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);

        // 2. Retrieval: Tìm kiếm các đoạn văn bản tương tự trong CSDL
        const similarChunks = await knowledgeModel.findSimilar(promptEmbedding, 3); // Giờ sẽ trả về [{ content, distance }, ...]

        // 3. Augment & Generate: Áp dụng "Relevance Check Guardrail" với ngưỡng hợp lý hơn
        const DISTANCE_THRESHOLD = 0.5; // Ngưỡng chấp nhận (cosine distance, 0=giống, 2=khác). Càng nhỏ càng liên quan.
        let augmentedPrompt;
        let systemPrompt;
        let useGoogleSearch = true; // Mặc định là dùng Google Search cho câu hỏi chung

        // Lọc ra các chunk có khả năng liên quan dựa trên ngưỡng distance
        const potentialChunks = similarChunks.filter(chunk => chunk.distance <= DISTANCE_THRESHOLD);
        
        if (potentialChunks.length > 0) {
            // Nếu tìm thấy chunk tiềm năng, kiểm tra lại độ liên quan bằng AI
            const context = potentialChunks.map(chunk => chunk.content).join('\n\n---\n\n');
            const isRelevant = await aiService.checkContextRelevance(context, prompt);

            if (isRelevant) {
                // TRƯỜNG HỢP 1: CÂU HỎI THỰC SỰ LIÊN QUAN (ĐÃ ĐƯỢC AI XÁC NHẬN)
                console.log(`[AI Chat] Context is relevant (confirmed by AI). Closest distance: ${similarChunks[0].distance}`);
                // Thiết lập prompt cho RAG và tắt Google Search
                systemPrompt = `Bạn là trợ lý ảo chuyên nghiệp của "Công Hải Số". Nhiệm vụ của bạn là trả lời câu hỏi của người dùng một cách chính xác và súc tích, CHỈ DỰA VÀO thông tin được cung cấp trong phần "TÀI LIỆU" dưới đây. Nếu thông tin không có trong tài liệu, hãy trả lời "Tôi không tìm thấy thông tin về vấn đề này trong tài liệu nghiệp vụ."`;
                augmentedPrompt = `--- BẮT ĐẦU TÀI LIỆU ---\n${context}\n--- KẾT THÚC TÀI LIỆU ---\n\nHãy trả lời câu hỏi của người dùng: "${prompt}"`;
                useGoogleSearch = false;
            } else {
                // TRƯỜNG HỢP 2A: Tìm thấy context nhưng AI xác nhận KHÔNG liên quan -> Chuyển sang trả lời chung
                console.log(`[AI Chat] Context found but deemed irrelevant by AI check. Lowest distance: ${similarChunks[0].distance}. Answering generally.`);
            }
        } else {
            // TRƯỜNG HỢP 2B: Không tìm thấy context nào vượt ngưỡng -> Chắc chắn là câu hỏi chung
            const lowestDistance = similarChunks.length > 0 ? similarChunks[0].distance : 'N/A';
            console.log(`[AI Chat] No relevant context found. Lowest distance: ${lowestDistance}. Answering generally.`);
        }

        // Nếu là câu hỏi chung (useGoogleSearch vẫn là true), thiết lập prompt tương ứng
        if (useGoogleSearch) {
            systemPrompt = "Bạn là trợ lý ảo của Công Hải Số. Hãy trả lời câu hỏi của người dùng một cách ngắn gọn và thân thiện bằng kiến thức chung của bạn.";
            augmentedPrompt = prompt; // Chỉ gửi câu hỏi gốc
        }

        // 4. Generate: Xây dựng history và gọi Gemini
        // Luôn bắt đầu với system prompt để định vai trò cho AI
        const history = [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Vâng, tôi đã hiểu. Tôi là trợ lý ảo của Công Hải Số. Tôi đã sẵn sàng trả lời các câu hỏi." }] },
        ];

        // Gọi service với các tham số đúng thứ tự
        // augmentedPrompt chính là câu hỏi cuối cùng của người dùng (đã được tăng cường hoặc chưa)
        const reply = await aiService.generateChatResponse(augmentedPrompt, history, useGoogleSearch);

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