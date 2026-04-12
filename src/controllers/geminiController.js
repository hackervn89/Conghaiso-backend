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
            const hasInternalContext = similarChunks.length > 0;

            const context = similarChunks.map(chunk => {
                const metadata = [
                    chunk.doc_type ? `Loại văn bản: ${chunk.doc_type}` : null,
                    chunk.symbol ? `Số ký hiệu: ${chunk.symbol}` : null,
                    chunk.summary ? `Trích yếu: ${chunk.summary}` : null,
                    chunk.issued_date ? `Ngày ban hành: ${new Date(chunk.issued_date).toLocaleDateString('vi-VN')}` : null,
                    chunk.file_url ? `Link gốc: ${chunk.file_url}` : null,
                ].filter(Boolean).join('\n');

                return `${metadata}\nNội dung chunk:\n${chunk.content}`.trim();
            }).join('\n\n---\n\n');

            const systemInstruction = `Bạn là trợ lý ảo chatCHS của xã Công Hải.

${hasInternalContext ? `Dưới đây là NGỮ CẢNH nội bộ liên quan để tham khảo ưu tiên:
--- BẮT ĐẦU NGỮ CẢNH ---
${context}
--- KẾT THÚC NGỮ CẢNH ---` : 'Hiện không có ngữ cảnh nội bộ đủ mạnh đi kèm cho câu hỏi này.'}

YÊU CẦU:
1. Luôn cố gắng trả lời được câu hỏi của người dùng một cách hữu ích, đầy đủ và tự nhiên.
2. Nếu ngữ cảnh nội bộ ở trên liên quan và đủ thông tin, ưu tiên dùng nó làm căn cứ chính.
3. Nếu ngữ cảnh nội bộ chỉ đủ một phần, hãy kết hợp: phần nào chắc chắn theo tài liệu nội bộ thì nêu theo tài liệu; phần còn thiếu có thể bổ sung bằng kiến thức chung của bạn một cách thận trọng.
4. Nếu không có hoặc không đủ tài liệu nội bộ, bạn VẪN phải trả lời bằng kiến thức chung/suy luận hợp lý của mình, thay vì từ chối kiểu "chưa được huấn luyện".
5. Khi câu trả lời có dùng kiến thức ngoài tài liệu nội bộ, hãy ghi rõ ngắn gọn cuối câu trả lời: "Lưu ý: phần trả lời này dựa trên kiến thức chung, không phải trích xuất từ tài liệu nội bộ của xã Công Hải."
6. Nếu trong ngữ cảnh có "Link gốc", khi trích dẫn văn bản nội bộ hãy đặt cuối ý liên quan theo dạng Markdown: [📄 Xem văn bản gốc](URL).
7. Giữ giọng điệu chuyên nghiệp, rõ ràng, hữu ích; không nói rằng bạn bị giới hạn huấn luyện trừ khi thật sự không thể suy luận hoặc thông tin có rủi ro cao.
8. Với câu hỏi về thời sự/nhân sự/chức danh có thể thay đổi theo thời gian, nếu bạn không có dữ liệu cập nhật chắc chắn thì phải nói rõ có thể đã thay đổi và khuyên người dùng kiểm tra nguồn chính thức mới nhất.`;

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
                    systemInstruction: `Bạn là chatCHS. Hãy trả lời hữu ích và đầy đủ dựa trên kết quả công cụ. Nếu kết quả công cụ chưa đủ, bạn được phép dùng kiến thức chung để hoàn thiện câu trả lời. Khi có phần không đến từ tài liệu nội bộ, hãy ghi chú ngắn gọn rằng đó là kiến thức chung chứ không phải trích xuất từ tài liệu nội bộ của xã Công Hải.`,
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