const { GoogleGenerativeAI } = require('@google/generative-ai');
// Giả sử bạn có model này (hoặc import từ đâu đó)
// const { getChatHistory, saveChatHistory } = require('../models/chatHistoryModel'); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Các Model được khởi tạo ---

// [REFACTOR] Chỉ sử dụng một model duy nhất, có khả năng tìm kiếm Google.
const chatModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ "google_search": {} }], // Bật Google Search
});

// Model dùng để tạo vector
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });


// --- Hàm 1: Tạo Embedding (Tên hàm theo logic của đội bạn) ---
/**
 * Tạo embedding cho văn bản.
 * @param {string} text - Văn bản cần tạo embedding.
 * @param {TaskType} taskType - Loại tác vụ embedding.
 * @returns {Array<number>} - Vector embedding.
 */
const generateEmbedding = async (textOrChunks, taskType, title = undefined) => {
    try {
        if (Array.isArray(textOrChunks)) {
            // ĐÂY LÀ LOGIC MỚI: XỬ LÝ CHIA LÔ (BATCHING)
            const BATCH_SIZE = 100; // Tuân thủ giới hạn 100 của Google
            let allEmbeddings = [];

            // [FIX] Cấu trúc request cho batchEmbedContents yêu cầu `content` phải là một đối tượng Content,
            // không phải là một chuỗi.
            const requests = textOrChunks.map(chunk => ({
                content: { role: "user", parts: [{ text: chunk }] },
                taskType: taskType
            }));

            console.log(`[AI Service]: Đang tạo embedding cho ${requests.length} chunk, chia thành các lô ${BATCH_SIZE}...`);

            for (let i = 0; i < requests.length; i += BATCH_SIZE) {
                const batchRequests = requests.slice(i, i + BATCH_SIZE);
                
                console.log(`[AI Service]: Đang gửi lô ${Math.floor(i / BATCH_SIZE) + 1}...`);
                
                const result = await embeddingModel.batchEmbedContents({ requests: batchRequests });
                
                // Chú ý: API của Google trả về 'embeddings', không phải 'data.embeddings'
                const embeddings = result.embeddings.map(e => e.values);
                allEmbeddings.push(...embeddings);
            }

            console.log(`[AI Service]: Đã tạo thành công ${allEmbeddings.length} embeddings.`);
            return allEmbeddings;

        } else {
            // Logic cho một text (giữ nguyên)
            const result = await embeddingModel.embedContent({
                content: { role: "user", parts: [{ text: textOrChunks }] },
                taskType: taskType,
                title: title
            });
            return result.embedding.values;
        }
    } catch (error) {
        console.error('Lỗi khi tạo embedding (generateEmbedding):', error);
        throw new Error('Lỗi khi tạo embedding');
    }
};

// --- Hàm 2: Lấy câu trả lời Chat (ĐÃ NÂNG CẤP) ---
/**
 * Lấy phản hồi chat từ Gemini.
 * @param {object} options - Các tùy chọn cho việc chat.
 * @param {string} options.systemInstruction - Chỉ dẫn hệ thống cho AI.
 * @param {Array} options.history - Lịch sử chat thực tế.
 * @param {string} options.prompt - Câu hỏi mới của người dùng.
 * @returns {string} - Câu trả lời của AI.
 */
const generateChatResponse = async ({ systemInstruction, history = [], prompt }) => {
    try {
        console.log("[AI Service] Using unified model with Google Search.");

        // Bắt đầu chat với history được cung cấp
        const chat = chatModel.startChat({ 
            history: history,
            systemInstruction: { role: "system", parts: [{ text: systemInstruction }] }
        });
        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        
        return response.text();
    } catch (error) {
        console.error('Lỗi khi gọi Gemini API (generateChatResponse):', error);
        throw new Error('Lỗi khi lấy phản hồi từ AI');
    }
};

module.exports = {
    generateEmbedding,
    generateChatResponse,
};
