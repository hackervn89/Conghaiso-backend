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

        // --- [REFACTOR] Tái cấu trúc logic prompt ---
        let systemInstruction = `Bạn là trợ lý ảo chuyên nghiệp của "Công Hải Số".`;
        let userPrompt = prompt; // Giữ nguyên prompt gốc của người dùng

        // --- Bước 2: Xây dựng prompt dựa trên quyết định của router ---
        if (decision === 'ACTIVATE_RAG') {
            console.log('[AI Chat] Kích hoạt RAG dựa trên quyết định của router.');
            // 2.1. Tạo embedding cho câu hỏi
            const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);
 
            // 2.2. Tìm các chunks tương tự
            const similarChunks = await knowledgeModel.findSimilar(promptEmbedding, 5); // Lấy 5 chunks liên quan nhất
 
            // 2.3. Xây dựng context và prompt cuối cùng
            const context = similarChunks.map(chunk => chunk.content).join('\n\n---\n\n');
            
            // [REFACTOR] Thay vì gói prompt của người dùng, chúng ta đưa context vào system instruction.
            // Điều này giúp AI hiểu rõ vai trò của nó và nguồn dữ liệu tham khảo.
            systemInstruction = `Bạn là trợ lý ảo chuyên nghiệp của "Công Hải Số".
Hãy phân tích tài liệu tham khảo dưới đây để trả lời câu hỏi của người dùng.
--- BẮT ĐẦU TÀI LIỆU THAM KHẢO ---
${context}
--- KẾT THÚC TÀI LIỆU THAM KHẢO ---
---
CHỈ DẪN QUAN TRỌNG:
1. ƯU TIÊN SỐ 1: Nếu câu hỏi liên quan đến "TÀI LIỆU THAM KHẢO", hãy trả lời dựa trên tài liệu đó.
2. ƯU TIÊN SỐ 2: Nếu tài liệu không đủ thông tin hoặc câu hỏi không liên quan, hãy sử dụng kiến thức chung và công cụ tìm kiếm Google Search để trả lời.
3. Luôn trả lời trực tiếp vào câu hỏi, không cần đề cập đến việc bạn có dùng tài liệu hay không.`;
 
        } else { // decision === 'DIRECT_FALLBACK'
            console.log('[AI Chat] Sử dụng Fallback (kiến thức chung & Google Search) dựa trên quyết định của router.');
            // [REFACTOR] System instruction đơn giản hơn, không cần gói prompt người dùng.
            systemInstruction = `Bạn là trợ lý ảo chuyên nghiệp của "Công Hải Số". Hãy trả lời câu hỏi của người dùng dựa trên kiến thức chung và sử dụng công cụ tìm kiếm Google Search để có thông tin mới nhất.`;
        }
 
        // --- Bước 3: Generate - Xây dựng history và gọi Gemini ---
        // [REFACTOR] Gọi API theo cách chuẩn: tách biệt systemInstruction, history và prompt mới.
        // Không còn tạo "lịch sử giả" nữa.
        const reply = await aiService.generateChatResponse({
            systemInstruction: systemInstruction,
            history: history, // Lịch sử chat thực tế từ client
            prompt: userPrompt // Câu hỏi thực tế của người dùng
        });
 
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