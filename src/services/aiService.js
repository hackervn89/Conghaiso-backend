const { GoogleGenerativeAI } = require('@google/generative-ai');

const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-3.1-flash-lite-preview';
const RAG_MODEL = process.env.RAG_MODEL || 'gemini-3.1-flash-lite-preview';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBEDDING_OUTPUT_DIMENSIONS = Number(process.env.EMBEDDING_OUTPUT_DIMENSIONS || 0);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const chatLiteModel = genAI.getGenerativeModel({ model: CHAT_MODEL });
const ragModel = genAI.getGenerativeModel({
    model: RAG_MODEL,
    tools: [{ google_search: {} }],
});
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

const getEmbeddingConfig = () => {
    if (!Number.isInteger(EMBEDDING_OUTPUT_DIMENSIONS) || EMBEDDING_OUTPUT_DIMENSIONS <= 0) {
        return undefined;
    }

    return { outputDimensionality: EMBEDDING_OUTPUT_DIMENSIONS };
};

const generateEmbedding = async (textOrChunks, taskType, title = undefined) => {
    try {
        if (Array.isArray(textOrChunks)) {
            const BATCH_SIZE = 100;
            let allEmbeddings = [];

            const embeddingConfig = getEmbeddingConfig();
            const requests = textOrChunks.map((chunk) => ({
                content: { role: 'user', parts: [{ text: chunk }] },
                taskType,
                ...(embeddingConfig ? { outputDimensionality: embeddingConfig.outputDimensionality } : {}),
            }));

            console.log(`[AI Service] Embedding ${requests.length} chunks (Model: ${EMBEDDING_MODEL}${embeddingConfig ? `, Dimensions: ${embeddingConfig.outputDimensionality}` : ''})...`);

            for (let i = 0; i < requests.length; i += BATCH_SIZE) {
                const batchRequests = requests.slice(i, i + BATCH_SIZE);
                const result = await embeddingModel.batchEmbedContents({ requests: batchRequests });
                const embeddings = result.embeddings.map((e) => e.values);
                allEmbeddings.push(...embeddings);
            }

            return allEmbeddings;
        }

        const embeddingConfig = getEmbeddingConfig();
        const result = await embeddingModel.embedContent({
            content: { role: 'user', parts: [{ text: textOrChunks }] },
            taskType,
            title,
            ...(embeddingConfig ? { outputDimensionality: embeddingConfig.outputDimensionality } : {}),
        });
        return result.embedding.values;
    } catch (error) {
        console.error('Lỗi khi tạo embedding:', error.message);
        throw new Error('Lỗi dịch vụ AI Embedding');
    }
};

const generateChatResponse = async ({ systemInstruction, history = [], prompt, tools = [], modelType = 'flash' }) => {
    const MAX_RETRIES = 3;
    const INITIAL_RETRY_DELAY_MS = 2000;

    const chatModel = modelType === 'flash-lite' ? chatLiteModel : ragModel;
    const modelName = modelType === 'flash-lite' ? CHAT_MODEL : RAG_MODEL;

    const execute = async (retriesLeft, delay) => {
        try {
            const modelParams = {
                history,
                systemInstruction: systemInstruction ? { role: 'system', parts: [{ text: systemInstruction }] } : undefined,
                tools,
            };

            Object.keys(modelParams).forEach((key) => modelParams[key] === undefined && delete modelParams[key]);

            const chat = chatModel.startChat(modelParams);
            const result = await chat.sendMessage(prompt);
            const response = await result.response;

            return { text: response.text(), functionCalls: response.functionCalls() };
        } catch (error) {
            const isRetryable =
                error.name === 'GoogleGenerativeAIFetchError' &&
                (error.message.includes('503') || error.message.includes('429'));

            if (isRetryable && retriesLeft > 0) {
                console.warn(`[AI Service] Model ${modelName} bận/quá hạn mức. Thử lại sau ${delay / 1000}s... (Còn ${retriesLeft} lần)`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                return execute(retriesLeft - 1, delay * 2);
            }

            console.error(`Lỗi nghiêm trọng từ Gemini API (${modelName}):`, error.message);
            return {
                text: 'Hệ thống AI đang quá tải hoặc đã hết hạn mức sử dụng trong ngày. Vui lòng thử lại sau.',
                functionCalls: [],
            };
        }
    };

    return execute(MAX_RETRIES, INITIAL_RETRY_DELAY_MS);
};

module.exports = {
    generateEmbedding,
    generateChatResponse,
};
