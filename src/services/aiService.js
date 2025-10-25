const { GoogleGenerativeAI } = require('@google/generative-ai');
// Giả sử bạn có model này (hoặc import từ đâu đó)
// const { getChatHistory, saveChatHistory } = require('../models/chatHistoryModel'); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Các Model được khởi tạo ---

// Model này dùng cho RAG (khi có context) và check relevance
const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

// Model này dùng riêng cho câu hỏi chung, CÓ BẬT GOOGLE SEARCH
const groundedModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ "google_search": {} }], // Bật Google Search
});

// Model dùng để tạo vector
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });


// --- Hàm 1: Tạo Embedding (Tên hàm theo logic của đội bạn) ---
/**
 * Tạo embedding cho văn bản.
 * @param {string} text - Văn bản cần tạo embedding.
 * @returns {Array<number>} - Vector embedding.
 */
const generateEmbedding = async (text) => {
    try {
        const result = await embeddingModel.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error('Lỗi khi tạo embedding (generateEmbedding):', error);
        throw new Error('Lỗi khi tạo embedding');
    }
};

// --- Hàm 2: Lấy câu trả lời Chat (ĐÃ NÂNG CẤP) ---
/**
 * Lấy phản hồi chat từ Gemini.
 * @param {string} prompt - Câu hỏi của người dùng (đã qua xử lý RAG hoặc chưa).
 * @param {Array} history - Lịch sử chat.
 * @param {boolean} useGrounding - CỜ QUYẾT ĐỊNH: Có dùng Google Search hay không.
 * @returns {string} - Câu trả lời của AI.
 */
const generateChatResponse = async (prompt, history = [], useGrounding = false) => {
    try {
        let modelToUse;

        if (useGrounding) {
            // Trường hợp 2: Dùng model đã bật Google Search
            console.log("[AI Service] Using Grounded Model (Google Search).");
            modelToUse = groundedModel;
        } else {
            // Trường hợp 1: Dùng model RAG tiêu chuẩn (không Google Search)
            console.log("[AI Service] Using Standard RAG Model.");
            modelToUse = chatModel;
        }

        // Bắt đầu chat với history được cung cấp
        const chat = modelToUse.startChat({ history: history });
        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        
        return response.text();

    } catch (error) {
        console.error('Lỗi khi gọi Gemini API (generateChatResponse):', error);
        throw new Error('Lỗi khi lấy phản hồi từ AI');
    }
};

// --- Hàm 3: Kiểm tra độ liên quan (Logic của đội bạn) ---
/**
 * Gọi AI để kiểm tra xem prompt có liên quan đến context không.
 * @param {string} context - Các đoạn tài liệu RAG.
 * @param {string} prompt - Câu hỏi của người dùng.
 * @returns {boolean} - True nếu liên quan, False nếu không.
 */
const checkContextRelevance = async (context, prompt) => {
    try {        
        // Sử dụng một model nhanh và rẻ cho tác vụ phân loại này
        const relevanceCheckModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const relevancePrompt = `Dưới đây là một số tài liệu và một câu hỏi. Hãy cho biết các tài liệu này có chứa thông tin để trả lời câu hỏi không. Chỉ trả lời "CÓ" hoặc "KHÔNG".
        
            --- TÀI LIỆU ---
${context}
--- KẾT THÚC TÀI LIỆU ---

Câu hỏi: "${prompt}"`;

        // Dùng model chat tiêu chuẩn để kiểm tra
        const result = await relevanceCheckModel.generateContent(relevancePrompt);
        const response = await result.response;
        const text = response.text().trim().toUpperCase();

        console.log(`[AI Relevance Check] Model response: "${text}"`);
        return text.includes('CÓ');

    } catch (error) {
        console.error('Lỗi khi kiểm tra độ liên quan (checkContextRelevance):', error);
        // Mặc định an toàn là "không liên quan" nếu có lỗi
        return false; 
    }
};


module.exports = {
    generateEmbedding,
    generateChatResponse,
    checkContextRelevance,
};
