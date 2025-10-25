const { GoogleGenerativeAI, TaskType } = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEY) {
    console.error("[FATAL] Biến môi trường GEMINI_API_KEY chưa được thiết lập. Chức năng AI sẽ thất bại.");
}

// Khởi tạo Gemini AI với khóa API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Khởi tạo các model sẽ sử dụng
// - text-embedding-004: Model chuyên dụng để tạo vector embedding.
// - gemini-1.5-pro-latest: Model mạnh mẽ và mới nhất cho việc trả lời câu hỏi.
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * Tạo một vector embedding từ một đoạn văn bản.
 * @param {string} text - Đoạn văn bản cần tạo embedding.
 * @param {TaskType} taskType - Loại tác vụ embedding (RETRIEVAL_QUERY hoặc RETRIEVAL_DOCUMENT).
 * @returns {Promise<number[]>} - Vector embedding.
 */
const generateEmbedding = async (text, taskType = TaskType.RETRIEVAL_DOCUMENT) => { // Giữ lại một khai báo hàm
    try {
        const result = await embeddingModel.embedContent({
            // [FIX] Sửa lại cấu trúc content để tuân thủ API của Google
            content: {
                parts: [{
                    text: text
                }]
            },
            taskType: taskType,
        });
        return result.embedding.values;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw new Error("Failed to generate text embedding.");
    }
};

/**
 * Bắt đầu một phiên trò chuyện với AI và gửi một prompt.
 * @param {string} systemPrompt - Chỉ dẫn ban đầu về vai trò của AI.
 * @param {string} userPrompt - Câu hỏi hoặc yêu cầu của người dùng.
 * @param {boolean} useGoogleSearch - Cờ để quyết định có sử dụng công cụ tìm kiếm không.
 * @returns {Promise<string>} - Câu trả lời từ AI.
 */
const generateChatResponse = async (systemPrompt, userPrompt, useGoogleSearch = false) => {
    try {
        let modelToUse = chatModel;
        if (useGoogleSearch) {
            console.log("[AI Service] Kích hoạt Google Search cho yêu cầu này.");
            // Tạo một model instance mới với công cụ tìm kiếm được kích hoạt
            modelToUse = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                tools: [{ "google_search": {} }],
            });
        }
        const chat = modelToUse.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Vâng, tôi đã hiểu. Tôi là trợ lý ảo của Công Hải Số. Tôi đã sẵn sàng trả lời các câu hỏi." }] },
            ],
        });

        const result = await chat.sendMessage(userPrompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error generating chat response:", error);
        throw new Error("Failed to get response from chat model.");
    }
};

/**
 * Sử dụng AI để kiểm tra xem ngữ cảnh có thực sự liên quan đến câu hỏi không.
 * @param {string} context - Các đoạn văn bản tìm được từ CSDL vector.
 * @param {string} question - Câu hỏi của người dùng.
 * @returns {Promise<boolean>} - True nếu liên quan, False nếu không.
 */
const checkContextRelevance = async (context, question) => {
    try {
        // Sử dụng một model nhanh và rẻ cho tác vụ phân loại này
        const relevanceCheckModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `Dưới đây là một số tài liệu và một câu hỏi. Hãy cho biết các tài liệu này có chứa thông tin để trả lời câu hỏi không. Chỉ trả lời "CÓ" hoặc "KHÔNG".

--- TÀI LIỆU ---
${context}
--- KẾT THÚC TÀI LIỆU ---

Câu hỏi: "${question}"`;

        const result = await relevanceCheckModel.generateContent(prompt);
        const responseText = result.response.text().trim().toUpperCase();
        console.log(`[AI Relevance Check] Model response: "${responseText}"`);
        return responseText.includes('CÓ');
    } catch (error) {
        console.error("Error checking context relevance:", error);
        return false; // Mặc định là không liên quan nếu có lỗi
    }
};

module.exports = {
    generateEmbedding,
    generateChatResponse,
    checkContextRelevance,
};