const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const chatModel = require('../models/chatModel'); // [MỚI] Import chatModel
const { functionDeclarations, availableTools } = require('../services/aiToolService');
const { TaskType } = require('@google/generative-ai');
const { routeQuery } = require('../services/queryRouterService');

/**
 * [NEW] Bộ lọc ý định đơn giản để xử lý các câu chào hỏi hoặc câu đơn giản.
 * @param {string} text - Prompt của người dùng.
 * @returns {string|null} - Trả về câu trả lời trực tiếp nếu khớp, ngược lại trả về null.
 */
function simpleIntentFilter(text) {
    const normalizedText = text.toLowerCase().trim();
    const greetings = ['xin chào', 'chào bạn', 'hello', 'hi'];
    const thanks = ['cảm ơn', 'cám ơn', 'thank you', 'thanks']; // [TỐI ƯU] Rút gọn mảng, chỉ cần từ khóa gốc

    // Logic cho lời chào: Phải đứng ở đầu câu
    const isGreetingOnly = greetings.some(g => {
        return normalizedText.startsWith(g) && normalizedText.length < g.length + 5;
    });
    if (isGreetingOnly) return 'Chào đồng chí, Tôi là Trợ lý ảo Công Hải số (**chatCHS**), tôi được xây dựng và huấn luyện bởi Văn phòng Đảng uỷ xã để phục vụ tốt hơn cho công tác của đồng chí, tôi có thể giúp gì cho bạn?';

    // [SỬA LỖI] Logic cho lời cảm ơn: Chỉ cần xuất hiện trong câu ngắn
    const isThankYouOnly = thanks.some(t => normalizedText.includes(t));
    // Câu được coi là "chỉ cảm ơn" nếu nó chứa từ khóa cảm ơn và có độ dài dưới 25 ký tự.
    if (isThankYouOnly && normalizedText.length < 25) {
        return 'Không có gì! Rất vui được hỗ trợ bạn!';
    }

    return null;
}

const chatWithAI = async (req, res) => {
    try {
        // [THAY ĐỔI] Nhận sessionId (tùy chọn) và prompt. Không còn nhận history.
        let { prompt, sessionId } = req.body; 
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }

        let history = [];
        // Nếu chưa có sessionId, tạo phiên mới.
        if (!sessionId) {
            sessionId = await chatModel.createSession(req.user.user_id, prompt);
        } else {
            // Nếu có sessionId, lấy lịch sử từ CSDL để làm ngữ cảnh.
            history = await chatModel.getHistoryBySessionId(sessionId, req.user.user_id);
        }
        // Lưu tin nhắn của người dùng vào CSDL.
        await chatModel.addMessage(sessionId, 'user', prompt);

        // --- Bước 0: Kiểm tra các ý định đơn giản trước ---
        const simpleReply = simpleIntentFilter(prompt);
        if (simpleReply) {
            await chatModel.addMessage(sessionId, 'model', simpleReply);
            return res.status(200).json({ reply: simpleReply, sessionId: sessionId });
        } 
        // --- Bước 1: Sử dụng bộ định tuyến để lấy quyết định ---
        const { decision } = await routeQuery(prompt);
        let finalReply = '';

        // [FIX] Tách biệt rõ ràng luồng xử lý RAG và Function Calling
        if (decision === 'USE_INTERNAL_TOOLS') {
            // --- LUỒNG 1: ƯU TIÊN RAG ---            
            const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);
            const similarChunks = await knowledgeModel.findSimilar(promptEmbedding, 5);
            const context = similarChunks.map(chunk => chunk.content).join('\n\n---\n\n');

            const systemInstruction = `Bạn là trợ lý ảo chatCHS, một trợ lý đặc biệt của xã Công Hải do Văn phòng Đảng uỷ tạo ra và huấn luyện.
Hãy phân tích tài liệu tham khảo dưới đây để trả lời câu hỏi của người dùng.
--- BẮT ĐẦU TÀI LIỆU THAM KHẢO ---
${context}
--- KẾT THÚC TÀI LIỆU THAM KHẢO ---
CHỈ DẪN QUAN TRỌNG:
1. ƯU TIÊN SỐ 1: Trả lời câu hỏi dựa trên "TÀI LIỆU THAM KHẢO".
2. Nếu tài liệu không đủ thông tin, hãy sử dụng kiến thức chung để trả lời. Tuyệt đối không nhắc đến việc bạn có dùng "Tài liệu tham khảo". Hãy trả lời một cách tự nhiên giống như đây là việc bạn đã biết vể việc đó chính xác. Chỉ trích dẫn nguồn tại liệu khi nào thấy cần thiết nhất.`;
            
            const ragPayload = {
                systemInstruction: systemInstruction,
                history: [...history],
                prompt: prompt,
                tools: [{ "google_search": {} }],
                modelType: 'flash' // Luồng RAG cần suy luận tốt, dùng Flash Model
            }; 
            const ragResponse = await aiService.generateChatResponse(ragPayload); // Mặc định đã là 'flash'
            finalReply = ragResponse.text;

        } else { // decision === 'USE_EXTERNAL_TOOLS'
            // --- LUỒNG 2: KHÔNG DÙNG RAG, CHỈ DÙNG CÁC CÔNG CỤ CSDL VÀ GOOGLE SEARCH ---
            console.log('[AI Chat] Router Decision: USE_EXTERNAL_TOOLS. Bắt đầu quy trình Function Calling...');            
            const externalTools = functionDeclarations.filter(tool => tool.name !== 'search_internal_knowledge_base');

            const firstCallPayload = {
                history: [...history],
                prompt: prompt,
                tools: [{ function_declarations: externalTools }, { "google_search": {} }],
                modelType: 'flash-lite' // Dùng Flash-Lite để quyết định công cụ cho nhanh và rẻ
            };            
            const modelResponse = await aiService.generateChatResponse(firstCallPayload); 
            const functionCalls = modelResponse.functionCalls;

            if (functionCalls && functionCalls.length > 0) {
                const toolResults = await Promise.all(functionCalls.map(async (call) => {
                    const toolFunction = availableTools[call.name];
                    if (toolFunction) {                        
                        const toolOutput = await toolFunction({ user: req.user, ...call.args });                        
                        return { part: { function_response: { name: call.name, response: { content: toolOutput } } } };
                    }
                    return { part: { function_response: { name: call.name, response: { content: `Lỗi: Không tìm thấy công cụ ${call.name}` } } } };
                }));

                const secondCallPayload = {
                    history: [
                        ...history,
                        { role: "user", parts: [{ text: prompt }] },
                        { role: "model", parts: functionCalls.map(fc => ({ function_call: fc })) }
                    ],
                    systemInstruction: `Bạn là trợ lý ảo chatCHS. Dựa vào kết quả từ các công cụ được cung cấp, hãy trả lời câu hỏi của người dùng. Tuyệt đối không nhắc đến việc bạn có dùng "tài liệu", "công cụ" hay "hàm". Hãy trả lời một cách tự nhiên giống như đây là việc bạn đã biết vể việc đó chính xác. Chỉ trích dẫn nguồn tại liệu khi nào thấy cần thiết nhất.`,
                    prompt: toolResults.map(tr => tr.part),
                    modelType: 'flash' 
                };                
                const secondResponse = await aiService.generateChatResponse(secondCallPayload); // Gọi Flash Model
                finalReply = secondResponse.text;

            } else {                
                const fallbackResponse = await aiService.generateChatResponse({ history: [...history], prompt: prompt, tools: [{ "google_search": {} }], modelType: 'flash' });
                finalReply = fallbackResponse.text;
            }
        }

        // [MỚI] Định dạng lại câu trả lời cuối cùng để in đậm tên "chatCHS"
        const formattedReply = finalReply.replace(/chatCHS/gi, '**chatCHS**');

        // --- Bước cuối: Lưu câu trả lời của AI vào CSDL và trả về kết quả ---
        await chatModel.addMessage(sessionId, 'model', formattedReply);
        res.status(200).json({ reply: formattedReply, sessionId: sessionId });

    } catch (error) {
        console.error('Error in chatWithAI:', error);
        if (error.message.includes("embedding") || error.message.includes("AI service")) {
            return res.status(503).json({ message: 'AI service is currently unavailable. Please try again later.' });
        }
        res.status(500).json({ message: 'Server error while processing chat request.' });
    }
};

module.exports = {
    chatWithAI,
};