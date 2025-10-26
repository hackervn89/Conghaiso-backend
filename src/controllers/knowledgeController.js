const knowledgeModel = require('../models/knowledgeModel');
const aiService = require('../services/aiService');
const storageService = require('../services/storageService');
const fs = require('fs/promises');
const pdf = require('pdf-extraction');
const mammoth = require('mammoth');
const path = require('path');
const { TaskType } = require('@google/generative-ai');

const SIMILARITY_THRESHOLD = 0.8; // Ngưỡng tương đồng, có thể điều chỉnh

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
async function chunkText(text) {
    const MAX_CHUNK_WORDS = 1500; // Giới hạn an toàn về số từ cho mỗi chunk

    // 1. Tách văn bản thành các câu.
    // Sử dụng regex để tách câu một cách thông minh hơn, giữ lại dấu câu.
    const rawSentences = text.match(/[^.!?]+[.!?]+(\s*|$)/g) || [text];

    // [FIX] Lọc ra các câu rỗng, chỉ chứa khoảng trắng, hoặc quá ngắn để tránh lỗi 400 từ Google API.
    // Một câu có ý nghĩa thường có ít nhất 10 ký tự.
    const MIN_SENTENCE_LENGTH = 10;
    const sentences = rawSentences.map(s => {
        // [FIX] Làm sạch chuỗi văn bản một cách triệt để.
        // 1. Thay thế tất cả các ký tự xuống dòng bằng một khoảng trắng.
        // 2. Loại bỏ các ký tự điều khiển không in được.
        // 3. Loại bỏ các khoảng trắng thừa liên tiếp.
        // 4. Loại bỏ khoảng trắng ở đầu/cuối.
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
        const currentChunkWordCount = currentChunkSentences.join(' ').split(/\s+/).length;

        // Điều kiện ngắt:
        // 1. Ngắt theo ngữ nghĩa (độ tương đồng thấp).
        // 2. Ngắt theo kích thước (chunk hiện tại + câu tiếp theo sẽ quá dài).
        if (similarities[i] < SIMILARITY_THRESHOLD || (currentChunkWordCount + nextSentence.split(/\s+/).length) > MAX_CHUNK_WORDS) {
            // Hoàn thành chunk hiện tại.
            chunks.push(currentChunkSentences.join(' ').trim());
            // Bắt đầu một chunk mới với câu tiếp theo.
            currentChunkSentences = [sentences[i + 1]];
        } else {
            // Nếu các câu vẫn còn tương đồng, tiếp tục thêm vào chunk hiện tại.
            currentChunkSentences.push(sentences[i + 1]);
        }
    }
    // Thêm chunk cuối cùng vào danh sách.
    chunks.push(currentChunkSentences.join(' ').trim());

    return chunks.filter(c => c.length > 0);
}

const createKnowledge = async (req, res) => {
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
        const chunks = await chunkText(fileContent);
        if (chunks.length === 0) {
            return res.status(400).json({ message: 'File content is too short or not formatted correctly to be chunked.' });
        }

        // 4. Lặp qua từng chunk, tạo embedding và lưu vào CSDL
        const ingestedChunks = [];
        for (const chunk of chunks) {
            // [FIX] Loại bỏ ký tự NULL (\x00) trước khi lưu vào CSDL
            // để tránh lỗi "invalid byte sequence for encoding UTF8"
            const sanitizedChunk = chunk.replace(/\x00/g, '');

            // [FIX] Cung cấp TaskType.RETRIEVAL_DOCUMENT khi tạo embedding để lưu trữ.
            // Đây là nguyên nhân gây ra lỗi 400 Bad Request.
            const embedding = await aiService.generateEmbedding(sanitizedChunk, TaskType.RETRIEVAL_DOCUMENT);

            const newKnowledge = await knowledgeModel.create({
                content: sanitizedChunk,
                category: category || 'Uncategorized',
                source_document: originalName, // Dùng tên file gốc làm nguồn
                embedding
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