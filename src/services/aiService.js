const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- CẤU HÌNH MODEL (Đã tối ưu hóa Quota) ---

// [UPDATE] Sử dụng Flash-8B: Phiên bản nhỏ nhất, nhanh nhất, tiết kiệm quota nhất.
// Dùng cho: Phân loại câu hỏi (Router), tóm tắt ngắn, tách từ khóa.
const flashLiteModel = genAI.getGenerativeModel({
    model: "gemini-2.5-pro-1p-freebie", 
});

// [UPDATE] Sử dụng Flash 1.5 Stable: Phiên bản ổn định, hạn mức miễn phí cao (1500 req/ngày).
// Dùng cho: Trả lời câu hỏi (RAG), suy luận, tổng hợp thông tin.
const flashModel = genAI.getGenerativeModel({
    model: "gemini-2.5-pro-1p-freebie",
    tools: [{ "google_search": {} }], // Bật Google Search
});

// Model dùng để tạo vector (Text Embedding 004 là chuẩn nhất hiện nay)
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });


// --- Hàm 1: Tạo Embedding ---
/**
 * Tạo embedding cho văn bản.
 * @param {string} text - Văn bản cần tạo embedding.
 * @param {TaskType} taskType - Loại tác vụ embedding.
 * @returns {Array<number>} - Vector embedding.
 */
const generateEmbedding = async (textOrChunks, taskType, title = undefined) => {
    try {
        if (Array.isArray(textOrChunks)) {
            // Logic Batching (Chia lô) để tiết kiệm request và tăng tốc độ
            const BATCH_SIZE = 100; // Giới hạn của Google là 100 text/request
            let allEmbeddings = [];

            const requests = textOrChunks.map(chunk => ({
                content: { role: "user", parts: [{ text: chunk }] },
                taskType: taskType
            }));

            console.log(`[AI Service] Đang tạo embedding cho ${requests.length} chunk (Model: text-embedding-004)...`);

            for (let i = 0; i < requests.length; i += BATCH_SIZE) {
                const batchRequests = requests.slice(i, i + BATCH_SIZE);
                // console.log(`[AI Service] Xử lý lô ${Math.floor(i / BATCH_SIZE) + 1}...`);
                
                const result = await embeddingModel.batchEmbedContents({ requests: batchRequests });
                const embeddings = result.embeddings.map(e => e.values);
                allEmbeddings.push(...embeddings);
            }

            return allEmbeddings;

        } else {
            // Logic cho một text lẻ
            const result = await embeddingModel.embedContent({
                content: { role: "user", parts: [{ text: textOrChunks }] },
                taskType: taskType,
                title: title
            });
            return result.embedding.values;
        }
    } catch (error) {
        console.error('Lỗi khi tạo embedding:', error.message);
        throw new Error('Lỗi dịch vụ AI Embedding');
    }
};

// --- Hàm 2: Lấy câu trả lời Chat ---
/**
 * Lấy phản hồi chat từ Gemini.
 * @param {object} options - Các tùy chọn.
 * @param {('flash-lite'|'flash')} [options.modelType='flash'] - Loại model.
 */
const generateChatResponse = async ({ systemInstruction, history = [], prompt, tools = [], modelType = 'flash' }) => {
    const MAX_RETRIES = 3;
    const INITIAL_RETRY_DELAY_MS = 2000;

    // Chọn model dựa trên tham số truyền vào
    // flash-lite -> gemini-1.5-flash-8b (Nhanh, Rẻ)
    // flash -> gemini-1.5-flash (Thông minh, Ổn định)
    const chatModel = modelType === 'flash-lite' ? flashLiteModel : flashModel;
    const modelName = modelType === 'flash-lite' ? 'gemini-2.5-pro-1p-freebie' : 'gemini-2.5-pro-1p-freebie';

    const execute = async (retriesLeft, delay) => {
        try {
            const modelParams = {
                history: history,
                systemInstruction: systemInstruction ? { role: "system", parts: [{ text: systemInstruction }] } : undefined,
                tools: tools
            };

            // console.log(`[AI Service] Gọi model ${modelName}...`);

            // Xóa các key undefined để tránh lỗi API
            Object.keys(modelParams).forEach(key => modelParams[key] === undefined && delete modelParams[key]);

            const chat = chatModel.startChat(modelParams);
            const result = await chat.sendMessage(prompt);
            const response = await result.response;
            
            return { text: response.text(), functionCalls: response.functionCalls() };
        } catch (error) {
            // Cơ chế tự động thử lại (Retry) khi gặp lỗi quá tải (429, 503)
            if (error.name === 'GoogleGenerativeAIFetchError' && (error.message.includes('503') || error.message.includes('429')) && retriesLeft > 0) {
                console.warn(`[AI Service] Model ${modelName} đang bận. Thử lại sau ${delay/1000}s... (Còn ${retriesLeft} lần)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return execute(retriesLeft - 1, delay * 2); // Exponential Backoff
            }
            
            console.error(`Lỗi nghiêm trọng từ Gemini API (${modelName}):`, error.message);
            
            // Trả về thông báo lỗi thân thiện thay vì làm sập server
            return { 
                text: "Hệ thống AI đang quá tải hoặc đã hết hạn mức sử dụng trong ngày. Vui lòng thử lại sau hoặc liên hệ quản trị viên để nâng cấp gói dịch vụ.", 
                functionCalls: [] 
            };
        }
    }

    return execute(MAX_RETRIES, INITIAL_RETRY_DELAY_MS);
};

module.exports = {
    generateEmbedding,
    generateChatResponse,
};