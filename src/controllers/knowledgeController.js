const knowledgeModel = require('../models/knowledgeModel');
const aiService = require('../services/aiService');
const storageService = require('../services/storageService');
const fs = require('fs/promises');
const pdf = require('pdf-extraction');
const mammoth = require('mammoth');
const path = require('path');
const { GoogleGenerativeAI, TaskType } = require('@google/generative-ai');

const SIMILARITY_THRESHOLD = 0.5; // [FIX] Giảm ngưỡng để tạo chunk lớn hơn, giàu ngữ cảnh hơn.
const MAX_TOKENS_PER_CHUNK = 50000; // [FIX] Giảm giới hạn token để chunk không quá dài, tránh làm nhiễu kết quả tìm kiếm.
const OVERLAP_SENTENCES_COUNT = 3; // Số câu chồng lấn giữa các chunk
/**
 * Tính toán độ tương đồng cosine giữa hai vector.
 * @param {number[]} vecA - Vector A.
 * @param {number[]} vecB - Vector B.
 * @returns {number} - Điểm tương đồng cosine.
 */
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Chia một văn bản lớn thành các đoạn nhỏ (chunks).
 * [REFACTOR] Sử dụng thuật toán chia văn bản theo ngữ nghĩa (Semantic Chunking).
 * @param {string} text - Nội dung văn bản.
 * @returns {string[]} - Mảng các chunks.
 */
async function chunkText(text, modelForTokens) { // Thêm tham số modelForTokens

    // 1. [REFACTOR] Tách văn bản thành các câu bằng regex mạnh mẽ hơn.
    // Regex này tìm các điểm ngắt (split points) giữa các câu, xử lý tốt hơn các trường hợp
    // như viết tắt (Mr., Dr.), số liệu (1.2.3), và URL.
    // Nó tìm một khoảng trắng theo sau dấu câu cuối câu, nhưng không phải là dấu chấm trong từ viết tắt hoặc số.
    const splitRegex = /(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|!)\s+/g;
    // Thay thế các ký tự xuống dòng bằng khoảng trắng trước khi tách để đảm bảo regex hoạt động đúng.
    const normalizedText = text.replace(/(\r\n|\n|\r)/gm, " ");
    const rawSentences = normalizedText.split(splitRegex).filter(s => s.length > 0);


    // [FIX] Lọc ra các câu rỗng, chỉ chứa khoảng trắng, hoặc quá ngắn để tránh lỗi 400 từ Google API.
    // Một câu có ý nghĩa thường có ít nhất 10 ký tự.
    const MIN_SENTENCE_LENGTH = 10;
    const sentences = rawSentences.map(s => {
        // [FIX] Làm sạch chuỗi văn bản một cách triệt để.
        // 1. Thay thế tất cả các ký tự xuống dòng bằng một khoảng trắng.
        // 2. Loại bỏ các ký tự điều khiển không in được.
        // 3. Loại bỏ các khoảng trắng thừa liên tiếp.
        // 4. Loại bỏ khoảng trắng ở đầu/cuối. (trim() đã được áp dụng trong split)
        return s.replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').replace(/\s\s+/g, ' ').trim();
    })
    .filter(s => s.length >= MIN_SENTENCE_LENGTH);

    if (sentences.length === 0) {
        return [];
    }
    if (sentences.length === 1) {
        return [sentences[0]];
    }

    // 2. Tạo embedding cho tất cả các câu.
    // Sử dụng batchEmbedContents để hiệu quả hơn.
    const embeddings = await aiService.generateEmbedding(sentences, TaskType.SEMANTIC_SIMILARITY);

    // 3. Tính toán độ tương đồng giữa các câu liên tiếp.
    const similarities = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
        const sim = cosineSimilarity(embeddings[i], embeddings[i + 1]);
        similarities.push(sim);
    }

    // 4. Xác định các điểm ngắt (split points) dựa trên ngưỡng.
    const chunks = [];
    let currentChunkSentences = [sentences[0]];

    for (let i = 0; i < similarities.length; i++) {
        const nextSentence = sentences[i + 1];
        const potentialChunkContent = currentChunkSentences.join(' ') + ' ' + nextSentence;
        // Sử dụng model.countTokens để đếm token chính xác
        const { totalTokens: tokensWithNextSentence } = await modelForTokens.countTokens(potentialChunkContent);

        // Điều kiện ngắt:
        // 1. Ngắt theo ngữ nghĩa (độ tương đồng thấp).
        // 2. Ngắt theo kích thước (chunk hiện tại + câu tiếp theo sẽ quá dài theo token).
        if (similarities[i] < SIMILARITY_THRESHOLD || tokensWithNextSentence > MAX_TOKENS_PER_CHUNK) {
            // Lấy N câu cuối cùng của chunk hiện tại để làm phần chồng lấn.
            const overlap = currentChunkSentences.slice(-OVERLAP_SENTENCES_COUNT);
            // Hoàn thành chunk hiện tại.
            chunks.push(currentChunkSentences.join(' ').trim());

            // Bắt đầu một chunk mới với sự chồng lấn từ chunk trước và câu tiếp theo.
            currentChunkSentences = [...overlap, sentences[i + 1]];
        } else {
            // Nếu các câu vẫn còn tương đồng, tiếp tục thêm vào chunk hiện tại.
            currentChunkSentences.push(sentences[i + 1]);
        }
    }
    // Thêm chunk cuối cùng vào danh sách.
    chunks.push(currentChunkSentences.join(' ').trim());

    // LỌC BỎ các chunk rỗng hoặc chỉ chứa khoảng trắng
    const validChunks = chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 0);

    return validChunks;
}

const createKnowledge = async (req, res) => {
    // Khởi tạo Gemini AI để đếm token
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelForTokens = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Sử dụng model phù hợp để đếm token
    try {
        // Thay vì 'content', chúng ta nhận 'tempFilePath' từ frontend
        const { category, tempFilePath } = req.body;
        if (!tempFilePath) {
            return res.status(400).json({ message: 'tempFilePath is required.' });
        }

        // 1. Di chuyển file từ thư mục tạm sang thư mục knowledge
        const { finalPath, originalName } = await storageService.moveFileToKnowledgeFolder(tempFilePath);

        // 2. Đọc nội dung từ file đã lưu
        const absoluteFilePath = path.join(storageService.STORAGE_BASE_PATH, finalPath);
        let fileContent = '';
        const fileExtension = path.extname(originalName).toLowerCase();

        if (fileExtension === '.docx') {
            const result = await mammoth.extractRawText({ path: absoluteFilePath });
            fileContent = result.value;
        } else if (fileExtension === '.pdf') {
            const dataBuffer = await fs.readFile(absoluteFilePath);
            const data = await pdf(dataBuffer);
            fileContent = data.text;
        } else if (fileExtension === '.txt') {
            fileContent = await fs.readFile(absoluteFilePath, 'utf-8');
        } else {
            return res.status(400).json({ message: `Unsupported file type: ${fileExtension}. Please upload .txt, .docx, or .pdf files.` });
        }

        // 3. Chia nhỏ (chunking) nội dung file
        const chunks = await chunkText(fileContent, modelForTokens); // Truyền modelForTokens vào hàm chunkText
        if (chunks.length === 0) {
            return res.status(400).json({ message: 'File content is too short or not formatted correctly to be chunked.' });
        }

        // 4. [REFACTOR] Tạo embedding cho TẤT CẢ các chunk trong một lần gọi API duy nhất
        // Điều này tận dụng logic batching trong aiService, tránh lỗi payload size và tăng hiệu suất.
        console.log(`[Knowledge] Generating embeddings for ${chunks.length} chunks in a single batch call...`);
        // [FIX] Loại bỏ ký tự NULL (\x00) khỏi tất cả các chunk trước khi tạo embedding
        const sanitizedChunks = chunks.map(chunk => chunk.replace(/\x00/g, ''));
        const embeddings = await aiService.generateEmbedding(sanitizedChunks, TaskType.RETRIEVAL_DOCUMENT);

        if (embeddings.length !== sanitizedChunks.length) {
            throw new Error('Mismatch between number of chunks and generated embeddings.');
        }

        // 5. Lặp qua các chunk và embedding đã tạo, sau đó lưu vào CSDL
        const ingestedChunks = [];
        for (let i = 0; i < sanitizedChunks.length; i++) {
            const chunkContent = sanitizedChunks[i];
            const chunkEmbedding = embeddings[i];
            
            const newKnowledge = await knowledgeModel.create({
                content: chunkContent,
                category: category || 'Uncategorized',
                source_document: originalName, // Dùng tên file gốc làm nguồn
                embedding: chunkEmbedding
            });
            ingestedChunks.push(newKnowledge);
        }

        res.status(201).json({ message: `Successfully ingested ${ingestedChunks.length} knowledge chunks from ${originalName}.`, chunks: ingestedChunks });
    } catch (error) {
        console.error('Error creating knowledge:', error);
        res.status(500).json({ message: 'Server error while creating knowledge.' });
    }
};

const updateKnowledge = async (req, res) => {
    try {
        const { id } = req.params;
        // Việc cập nhật sẽ chỉ cho phép sửa nội dung text của một chunk, không upload lại file
        const { content, category, source_document } = req.body; 
        if (!content) {
            return res.status(400).json({ message: 'Content is required.' });
        }

        const embedding = await aiService.generateEmbedding(content, TaskType.RETRIEVAL_DOCUMENT);
        const updatedKnowledge = await knowledgeModel.update(id, { content, category, source_document, embedding });

        if (!updatedKnowledge) {
            return res.status(404).json({ message: 'Knowledge not found.' });
        }

        res.status(200).json(updatedKnowledge);
    } catch (error) {
        console.error('Error updating knowledge:', error);
        res.status(500).json({ message: 'Server error while updating knowledge.' });
    }
};

const deleteKnowledge = async (req, res) => {
    try {
        const { id } = req.params;
        await knowledgeModel.remove(id);
        res.status(200).json({ message: 'Knowledge chunk deleted' });
    } catch (error) {
        console.error('Error deleting knowledge:', error);
        res.status(500).json({ message: 'Server error while deleting knowledge.' });
    }
};

const getKnowledgeList = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 15;
        const result = await knowledgeModel.findAll(page, limit);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error fetching knowledge list:', error);
        res.status(500).json({ message: 'Server error while fetching knowledge list.' });
    }
};

const getKnowledgeById = async (req, res) => {
    try {
        const { id } = req.params;
        const knowledge = await knowledgeModel.findById(id);
        if (!knowledge) {
            return res.status(404).json({ message: 'Knowledge not found.' });
        }
        res.status(200).json(knowledge);
    } catch (error) {
        console.error('Error fetching knowledge by ID:', error);
        res.status(500).json({ message: 'Server error while fetching knowledge.' });
    }
};

module.exports = { createKnowledge, updateKnowledge, deleteKnowledge, getKnowledgeList, getKnowledgeById };