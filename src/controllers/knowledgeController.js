const knowledgeModel = require('../models/knowledgeModel');
const aiService = require('../services/aiService');
const storageService = require('../services/storageService');
const fs = require('fs/promises');
const pdf = require('pdf-extraction');
const mammoth = require('mammoth');
const path = require('path');

/**
 * Chia một văn bản lớn thành các đoạn nhỏ (chunks).
 * [REFACTOR] Sử dụng thuật toán chia văn bản theo cấp bậc (Recursive Text Splitting)
 * để bảo toàn ngữ cảnh tốt hơn.
 * @param {string} text - Nội dung văn bản.
 * @returns {string[]} - Mảng các chunks.
 */
function chunkText(text) {
    const chunkSize = 8000; // Kích thước chunk tối đa
    const chunkOverlap = 200; // Độ dài gối lên nhau giữa các chunk
    const separators = ["\n\n", "\n", ". ", " ", ""];

    function splitTextWithSeparators(text, separators) {
        const finalChunks = [];
        let currentText = text;
        let separator = separators[0];

        for (let i = 0; i < separators.length; i++) {
            separator = separators[i];
            if (separator === "" && currentText.length > 0) {
                // Nếu không còn dấu phân tách, chia theo ký tự
                for (let j = 0; j < currentText.length; j += chunkSize) {
                    finalChunks.push(currentText.substring(j, j + chunkSize));
                }
                currentText = "";
                break;
            }

            const splits = currentText.split(separator);
            const newChunks = [];
            for (const split of splits) {
                if (split.length > chunkSize) {
                    // Nếu một phần vẫn quá lớn, đưa nó vào vòng lặp tiếp theo với dấu phân tách khác
                    newChunks.push(split);
                } else {
                    finalChunks.push(split);
                }
            }
            currentText = newChunks.join(separator);
        }
        if (currentText) finalChunks.push(currentText);
        return finalChunks;
    }

    const splits = splitTextWithSeparators(text, separators);
    const mergedChunks = [];
    let currentChunk = "";
    for (const split of splits) {
        if (currentChunk && (currentChunk.length + split.length > chunkSize)) {
            mergedChunks.push(currentChunk);
            currentChunk = currentChunk.slice(currentChunk.length - chunkOverlap);
        }
        currentChunk += (currentChunk ? "\n\n" : "") + split;
    }
    if (currentChunk) mergedChunks.push(currentChunk);

    return mergedChunks.filter(c => c.trim().length > 200); // Lọc bỏ các chunk quá ngắn
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
        const chunks = chunkText(fileContent);
        if (chunks.length === 0) {
            return res.status(400).json({ message: 'File content is too short or not formatted correctly to be chunked.' });
        }

        // 4. Lặp qua từng chunk, tạo embedding và lưu vào CSDL
        const ingestedChunks = [];
        for (const chunk of chunks) {
            // [FIX] Loại bỏ ký tự NULL (\x00) trước khi lưu vào CSDL
            // để tránh lỗi "invalid byte sequence for encoding UTF8"
            const sanitizedChunk = chunk.replace(/\x00/g, '');

            const embedding = await aiService.generateEmbedding(sanitizedChunk);
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

        const embedding = await aiService.generateEmbedding(content);
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