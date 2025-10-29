const aiService = require('../services/aiService');
// [FIX] Import lại knowledgeModel vì luồng RAG sẽ được xử lý trực tiếp tại đây
const knowledgeModel = require('../models/knowledgeModel');
const { functionDeclarations, availableTools } = require('../services/aiToolService'); // [NEW] Import tools
const { routeQuery } = require('../services/queryRouterService'); // [NEW] Import router service
const { TaskType } = require('@google/generative-ai');
const axios = require('axios');

/**
 * [NEW] Bộ lọc ý định đơn giản để xử lý các câu chào hỏi hoặc câu đơn giản.
 * @param {string} text - Prompt của người dùng.
 * @returns {string|null} - Trả về câu trả lời trực tiếp nếu khớp, ngược lại trả về null.
 */
function simpleIntentFilter(text) {
    const normalizedText = text.toLowerCase().trim();
    const greetings = ['xin chào', 'chào bạn', 'hello', 'hi'];
    const thanks = ['cảm ơn', 'thank you', 'thanks'];
    
    // [FIX] Thay đổi logic để chỉ khớp với các lời chào đơn giản, không phải các câu hỏi bắt đầu bằng lời chào.
    // Chỉ coi là lời chào nếu độ dài của prompt không dài hơn lời chào dài nhất quá 5 ký tự.
    const isGreetingOnly = greetings.some(g => {
        return normalizedText.startsWith(g) && normalizedText.length < g.length + 5;
    });

    if (isGreetingOnly) return 'Chào đồng chí, Tôi là Trợ lý ảo Công Hải số, tôi được xây dựng và huấn luyện bởi Văn phòng Đảng uỷ xã để phục vụ tốt hơn cho công tác của đồng chí, tôi có thể giúp gì cho bạn?';
    if (thanks.some(t => normalizedText.startsWith(t) && normalizedText.length < t.length + 5)) return 'Rất vui được giúp bạn!';
    return null;
}

const chatWithAI = async (req, res) => {
    try {
        let { prompt, history = [] } = req.body; // Nhận history từ request body
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }

        // --- Bước 0: Kiểm tra các ý định đơn giản trước ---
        const simpleReply = simpleIntentFilter(prompt);
        if (simpleReply) {
            history.push({ role: "user", parts: [{ text: prompt }] });
            history.push({ role: "model", parts: [{ text: simpleReply }] });
            console.log(`[AI Chat] Intent Filter: Matched simple intent. Replying directly: "${simpleReply}"`);
            return res.status(200).json({ reply: simpleReply, history });
        }

        console.log(`\n\n--- [AI Chat START] ---`);
        console.log(`[${new Date().toISOString()}] User: ${req.user.username} | Prompt: "${prompt}"`);

        // --- Bước 1: Sử dụng bộ định tuyến để lấy quyết định ---
        const { decision } = await routeQuery(prompt);
        let finalReply = '';

        // [FIX] Tách biệt rõ ràng luồng xử lý RAG và Function Calling
        if (decision === 'USE_INTERNAL_TOOLS') {
            // --- LUỒNG 1: ƯU TIÊN RAG ---
            // Mặc dù quyết định là USE_INTERNAL_TOOLS, chúng ta sẽ thực thi RAG trực tiếp
            // thay vì để AI lựa chọn. Đây là logic cốt lõi đã hoạt động tốt trước đây.
            console.log('[AI Chat] Router Decision: USE_INTERNAL_TOOLS. Bắt buộc thực thi quy trình RAG...');
            const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);
            const similarChunks = await knowledgeModel.findSimilar(promptEmbedding, 3);
            const context = similarChunks.map(chunk => chunk.content).join('\n\n---\n\n');
            
            const systemInstruction = `Bạn là trợ lý ảo đặc biệt của riêng xã Công Hải do Văn phòng Đảng uỷ tạo ra và huấn luyện để phục vụ cho xã Công Hải".
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
                tools: [{ "google_search": {} }] // [FIX] Bật Google Search cho cả luồng RAG
            };
            console.log('  - Gửi yêu cầu đến Gemini với ngữ cảnh RAG (Payload bên dưới)');

            const ragResponse = await aiService.generateChatResponse(ragPayload);
            finalReply = ragResponse.text;

        } else { // decision === 'USE_EXTERNAL_TOOLS'
            // --- LUỒNG 2: KHÔNG DÙNG RAG, CHỈ DÙNG CÁC CÔNG CỤ CSDL VÀ GOOGLE SEARCH ---
            console.log('[AI Chat] Router Decision: USE_EXTERNAL_TOOLS. Bắt đầu quy trình Function Calling...');
            
            // Loại bỏ công cụ RAG ('search_internal_knowledge_base') khỏi danh sách
            const externalTools = functionDeclarations.filter(tool => tool.name !== 'search_internal_knowledge_base');

            const firstCallPayload = {
                history: [...history],
                prompt: prompt,
                tools: [{ function_declarations: externalTools }, { "google_search": {} }]
            };
            console.log('  - Gửi yêu cầu đến Gemini để quyết định công cụ (Payload bên dưới)');
            const modelResponse = await aiService.generateChatResponse(firstCallPayload);
            const functionCalls = modelResponse.functionCalls;

            if (functionCalls && functionCalls.length > 0) {
                // AI quyết định gọi hàm CSDL
                console.log('[AI Chat] Model requested to call functions:', functionCalls.map(fc => fc.name));
                console.log('  - Chi tiết:', JSON.stringify(functionCalls, null, 2));

                const toolResults = await Promise.all(functionCalls.map(async (call) => {
                    const toolFunction = availableTools[call.name];
                    if (toolFunction) {
                        console.log(`\n[AI Chat] Thực thi công cụ "${call.name}"...`);
                        const toolOutput = await toolFunction({ user: req.user, ...call.args });
                        console.log(`  - Kết quả từ công cụ "${call.name}":\n`, toolOutput);
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
                    systemInstruction: `Bạn là trợ lý ảo chuyên nghiệp. Dựa vào kết quả từ các công cụ được cung cấp, hãy trả lời câu hỏi của người dùng. Tuyệt đối không nhắc đến việc bạn có dùng "công cụ" hay "hàm". Hãy trả lời một cách tự nhiên giống như đây là việc bạn đã biết vể việc đó chính xác. Chỉ trích dẫn nguồn tại liệu khi nào thấy cần thiết nhất.`,
                    prompt: toolResults.map(tr => tr.part)
                };
                console.log('  - Gửi kết quả công cụ trở lại Gemini để tổng hợp câu trả lời...');
                const secondResponse = await aiService.generateChatResponse(secondCallPayload);
                finalReply = secondResponse.text;

            } else {
                // AI không tìm thấy công cụ CSDL nào phù hợp -> Dùng Google Search
                console.log('[AI Chat] Model không gọi hàm CSDL. Sử dụng câu trả lời trực tiếp (đã được hỗ trợ bởi Google Search).');
                // [FIX] Mặc dù model chính đã bật search, việc gọi lại với cờ google_search rõ ràng
                // đảm bảo AI sẽ ưu tiên tìm kiếm nếu câu trả lời ban đầu không đủ tốt.
                const fallbackResponse = await aiService.generateChatResponse({ history: [...history], prompt: prompt, tools: [{ "google_search": {} }] });
                finalReply = fallbackResponse.text;
            }
        }

        // --- Bước cuối: Cập nhật lịch sử và trả về kết quả ---
        history.push({ role: "user", parts: [{ text: prompt }] });
        history.push({ role: "model", parts: [{ text: finalReply }] });

        console.log(`\n[AI Chat] Phản hồi cuối cùng (từ luồng ${decision}): "${finalReply}"`);
        console.log('--- [AI Chat END] ---\n');

        res.status(200).json({ reply: finalReply, history });

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