const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const chatModel = require('../models/chatModel');
const { functionDeclarations, availableTools } = require('../services/aiToolService');
const { TaskType } = require('@google/generative-ai');
const { routeQuery } = require('../services/queryRouterService');

/**
 * Bộ lọc ý định đơn giản (Lời chào, cảm ơn)
 */
function simpleIntentFilter(text) {
    const normalizedText = text.toLowerCase().trim();
    const greetings = ['xin chào', 'chào bạn', 'hello', 'hi'];
    const thanks = ['cảm ơn', 'cám ơn', 'thank you', 'thanks'];

    const isGreetingOnly = greetings.some(g => normalizedText.startsWith(g) && normalizedText.length < g.length + 5);
    if (isGreetingOnly) return 'Chào đồng chí, Tôi là Trợ lý ảo Công Hải số (**chatCHS**), tôi được xây dựng và huấn luyện bởi Văn phòng Đảng uỷ xã để phục vụ tốt hơn cho công tác của đồng chí, tôi có thể giúp gì cho bạn?';

    const isThankYouOnly = thanks.some(t => normalizedText.includes(t));
    if (isThankYouOnly && normalizedText.length < 25) {
        return 'Không có gì! Rất vui được hỗ trợ đồng chí!';
    }
    return null;
}

const chatWithAI = async (req, res) => {
    try {
        let { prompt, sessionId } = req.body; 
        if (!prompt) return res.status(400).json({ message: 'Prompt is required.' });

        let history = [];
        if (!sessionId) {
            sessionId = await chatModel.createSession(req.user.user_id, prompt);
        } else {
            history = await chatModel.getHistoryBySessionId(sessionId, req.user.user_id);
        }
        await chatModel.addMessage(sessionId, 'user', prompt);

        // 1. Kiểm tra chào hỏi
        const simpleReply = simpleIntentFilter(prompt);
        if (simpleReply) {
            await chatModel.addMessage(sessionId, 'model', simpleReply);
            return res.status(200).json({ reply: simpleReply, sessionId: sessionId });
        } 

        // 2. Định tuyến (Router)
        const { decision } = await routeQuery(prompt);
        let finalReply = '';

        if (decision === 'USE_INTERNAL_TOOLS') {
            // --- LUỒNG RAG ---
            console.log('[AI Chat] Decision: USE_INTERNAL_TOOLS (RAG)');
            
            // [FIX QUAN TRỌNG] Kiểm tra xem người dùng có muốn "Tổng hợp" không?
            const pLower = prompt.toLowerCase();
            const isSummaryRequest = pLower.includes('tổng hợp') || pLower.includes('toàn bộ') || pLower.includes('tất cả') || pLower.includes('danh sách');
            
            // Nếu tổng hợp -> Lấy 20 chunk để bao quát nhiều thôn/nhiều người.
            // Nếu hỏi cụ thể -> Lấy 5 chunk để chính xác và đỡ nhiễu.
            const kLimit = isSummaryRequest ? 20 : 5; 
            console.log(`[AI Chat] Chế độ tìm kiếm: ${isSummaryRequest ? 'TỔNG HỢP (Top 20)' : 'CỤ THỂ (Top 5)'}`);

            const promptEmbedding = await aiService.generateEmbedding(prompt, TaskType.RETRIEVAL_QUERY);
            
            // Gọi hàm findSimilar (Giả sử hàm này hỗ trợ tham số limit thứ 2, nếu chưa thì xem lại knowledgeModel)
            const similarChunks = await knowledgeModel.findSimilar(promptEmbedding, kLimit); // kLimit
            
            const context = similarChunks.map(chunk => chunk.content).join('\n\n---\n\n');

            const systemInstruction = `Bạn là trợ lý ảo chatCHS của xã Công Hải.
Dựa vào TÀI LIỆU THAM KHẢO dưới đây, hãy trả lời câu hỏi.
--- BẮT ĐẦU TÀI LIỆU ---
${context}
--- KẾT THÚC TÀI LIỆU ---
YÊU CẦU:
1. Trả lời chính xác dựa trên tài liệu.
2. Nếu câu hỏi yêu cầu tổng hợp hoặc so sánh (ví dụ: các thôn), hãy trích xuất thông tin từ TẤT CẢ các đoạn tài liệu có liên quan để lập bảng hoặc liệt kê đầy đủ.
3. Nếu tài liệu thiếu thông tin, hãy nói rõ là "Hiện tại tôi chưa được huấn luyện về vấn đề nay, mong bạn thông cảm".
4. Giữ giọng điệu chuyên nghiệp, hành chính, không bao giờ đề cập đến việc bạn đã được cung cấp tài liệu tham khảo, chỉ cần nêu theo kiến thức được cung cấp.`;
            
            const ragResponse = await aiService.generateChatResponse({
                systemInstruction: systemInstruction,
                history: history,
                prompt: prompt,
                modelType: 'flash' // Luôn dùng Flash cho RAG để suy luận tốt
            });
            finalReply = ragResponse.text;

        } else { 
            // --- LUỒNG FUNCTION CALLING (GOOGLE SEARCH, ETC.) ---
            console.log('[AI Chat] Decision: USE_EXTERNAL_TOOLS');
            const externalTools = functionDeclarations.filter(tool => tool.name !== 'search_internal_knowledge_base');

            const firstResponse = await aiService.generateChatResponse({
                history: history,
                prompt: prompt,
                tools: [{ function_declarations: externalTools }, { "google_search": {} }],
                modelType: 'flash-lite' // Lite cho function calling
            }); 
            const functionCalls = firstResponse.functionCalls;

            if (functionCalls && functionCalls.length > 0) {
                const toolResults = await Promise.all(functionCalls.map(async (call) => {
                    const toolFunction = availableTools[call.name];
                    if (toolFunction) {                        
                        const toolOutput = await toolFunction({ user: req.user, ...call.args });                        
                        return { part: { function_response: { name: call.name, response: { content: toolOutput } } } };
                    }
                    return { part: { function_response: { name: call.name, response: { content: "Tool not found" } } } };
                }));

                const secondResponse = await aiService.generateChatResponse({
                    history: [...history, { role: "user", parts: [{ text: prompt }] }, { role: "model", parts: functionCalls.map(fc => ({ function_call: fc })) }],
                    systemInstruction: `Bạn là chatCHS. Trả lời dựa trên kết quả công cụ.`,
                    prompt: toolResults.map(tr => tr.part),
                    modelType: 'flash'
                });
                finalReply = secondResponse.text;
            } else {                
                const fallback = await aiService.generateChatResponse({ 
                    history: history, prompt: prompt, tools: [{ "google_search": {} }], modelType: 'flash' 
                });
                finalReply = fallback.text;
            }
        }

        const formattedReply = finalReply.replace(/chatCHS/gi, '**chatCHS**');
        await chatModel.addMessage(sessionId, 'model', formattedReply);
        res.status(200).json({ reply: formattedReply, sessionId: sessionId });

    } catch (error) {
        console.error('Error in chatWithAI:', error);
        res.status(500).json({ message: 'Server error.' });
    }
};

module.exports = { chatWithAI };