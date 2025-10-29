const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const { TaskType } = require('@google/generative-ai');
const axios = require('axios');

const chatWithAI = async (req, res) => {
    try {
        let { prompt, history = [] } = req.body; // Nhận history từ request body
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }

        // --- Bước 1: Gọi đến "Bộ điều hướng" để lấy quyết định ---        
        // [FIX] Xây dựng URL một cách đáng tin cậy hơn cho môi trường production.
        // Khi chạy sau reverse proxy, req.protocol có thể là 'http' mặc dù client truy cập qua 'https'.
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
        const host = req.get('host');
        const routerUrl = `${protocol}://${host}/api/router/route-query`;
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
            systemInstruction = `Bạn là trợ lý ảo đặc biệt của riêng xã Công Hải do Hoàng Việt - Văn phòng Đảng uỷ tạo ra và huấn luyện để phục vụ cho xã Công Hải".
Hãy phân tích tài liệu tham khảo dưới đây để trả lời câu hỏi của người dùng.
--- BẮT ĐẦU TÀI LIỆU THAM KHẢO ---
${context}
--- KẾT THÚC TÀI LIỆU THAM KHẢO ---
---
CHỈ DẪN QUAN TRỌNG:
1. ƯU TIÊN SỐ 1: Nếu câu hỏi liên quan đến "TÀI LIỆU THAM KHẢO", hãy trả lời dựa trên tài liệu đó.
2. ƯU TIÊN SỐ 2: Nếu tài liệu không đủ thông tin hoặc câu hỏi không liên quan, hãy sử dụng kiến thức chung và công cụ tìm kiếm Google Search để trả lời.
3. Luôn trả lời trực tiếp vào câu hỏi, Tuyệt đối không nhắc đến việc bạn có dùng Tài liệu tham khảo`;
 
        } else { // decision === 'DIRECT_FALLBACK'
            console.log('[AI Chat] Sử dụng Fallback (kiến thức chung & Google Search) dựa trên quyết định của router.');
            // [REFACTOR] System instruction đơn giản hơn, không cần gói prompt người dùng.
            systemInstruction = `Bạn là trợ lý ảo đặc biệt của riêng xã Công Hải do Đ/c Hoàng Việt - Văn phòng Đảng uỷ xã tạo ra và huấn luyện để phục vụ cho xã Công Hải. Hãy trả lời câu hỏi của người dùng dựa trên kiến thức chung và sử dụng công cụ tìm kiếm Google Search để có thông tin mới nhất.`;
        }
 
        // --- Bước 3: Generate - Xây dựng history và gọi Gemini ---
        // [REFACTOR] Gọi API theo cách chuẩn: tách biệt systemInstruction, history và prompt mới.
        // [LOGGING] Ghi lại prompt cuối cùng được gửi đến Gemini bằng tiếng Việt
        console.log("\n--- [AI Chat] Chuẩn bị gửi yêu cầu đến Gemini ---");
        console.log("Quyết định của Router:", decision);
        console.log("Prompt gốc của người dùng:", prompt);
        console.log("Chỉ dẫn hệ thống (System Instruction):", systemInstruction);
        console.log("Độ dài lịch sử chat (History):", history.length);
        console.log("Prompt cuối cùng gửi đi:", userPrompt);
        console.log("---------------------------------------------\n");

        const reply = await aiService.generateChatResponse({
            systemInstruction: systemInstruction,
            history: [...history], // [FIX] Truyền một BẢN SAO của history để tránh bị sửa đổi bởi SDK
            prompt: userPrompt // Câu hỏi thực tế của người dùng
        });

        // Cập nhật lịch sử chat với prompt mới của người dùng và phản hồi của AI
        history.push({ role: "user", parts: [{ text: userPrompt }] });
        history.push({ role: "model", parts: [{ text: reply }] });

        // [LOGGING] Ghi lại dữ liệu phản hồi gửi về frontend
        console.log("\n--- [AI Chat] Dữ liệu gửi về Frontend ---");
        console.log("Câu trả lời (reply):", reply);
        console.log("Lịch sử chat đã cập nhật (history) - Độ dài:", history.length, "Nội dung:", history);
        console.log("-------------------------------------------\n");
        // Trả về cả câu trả lời và lịch sử chat đã cập nhật
        res.status(200).json({ reply, history });
 

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