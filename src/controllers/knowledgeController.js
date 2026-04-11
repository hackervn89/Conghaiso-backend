const storageService = require('../services/storageService');
const { generateKnowledgeChunks } = require('../services/chunkingService');
const aiService = require('../services/aiService');
const knowledgeModel = require('../models/knowledgeModel');
const {
    extractTextFromKnowledgeFile,
    ingestChunksToKnowledge,
    ingestFromTempPath,
} = require('../services/knowledgeIngestService');
const { TaskType } = require('@google/generative-ai');

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    return false;
};

const decodeFilename = (filename = '') => {
    try {
        return Buffer.from(filename, 'latin1').toString('utf8');
    } catch {
        return filename;
    }
};

const ingestUploadedKnowledgeFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Vui lòng chọn tệp cần nạp tri thức (field: document).' });
        }

        const replaceExisting = toBoolean(req.body.replaceExisting);
        const category = req.body.category;

        const fileForStorage = {
            ...req.file,
            originalname: decodeFilename(req.file.originalname),
        };

        const tempPath = await storageService.saveFileToTempFolder(fileForStorage);
        const { chunks, ingestedChunks } = await ingestFromTempPath({
            tempFilePath: tempPath,
            category,
            replaceExisting,
        });

        return res.status(201).json({
            message: `Nạp tri thức thành công từ tệp ${fileForStorage.originalname}.`,
            source_document: fileForStorage.originalname,
            chunk_count: chunks.length,
            ingested_count: ingestedChunks.length,
            replaceExisting,
        });
    } catch (error) {
        if (error.message === 'UNSUPPORTED_FILE_TYPE') {
            return res.status(400).json({ message: 'Định dạng tệp không hỗ trợ. Chỉ hỗ trợ: .pdf, .docx, .txt' });
        }
        if (error.message === 'EMPTY_EXTRACTED_CONTENT') {
            return res.status(400).json({ message: 'Không trích xuất được nội dung hữu ích từ tệp.' });
        }
        if (error.message === 'PDF_NO_TEXT_LAYER') {
            return res.status(400).json({ message: 'PDF này có thể là file scan ảnh (không có text layer). Vui lòng OCR trước hoặc dùng bản PDF có thể copy text.' });
        }

        console.error('Error ingesting uploaded knowledge file:', error);
        return res.status(500).json({ message: 'Đã có lỗi xảy ra khi nạp tri thức từ tệp.' });
    }
};

const createKnowledge = async (req, res) => {
    try {
        const { category, tempFilePath } = req.body;
        const replaceExisting = toBoolean(req.body.replaceExisting);

        if (!tempFilePath) {
            return res.status(400).json({ message: 'tempFilePath is required.' });
        }

        const { chunks, ingestedChunks } = await ingestFromTempPath({
            tempFilePath,
            category,
            replaceExisting,
        });

        return res.status(201).json({
            message: `Ingested ${ingestedChunks.length} chunks.`,
            chunk_count: chunks.length,
            ingested_count: ingestedChunks.length,
            replaceExisting,
            chunks: ingestedChunks,
        });
    } catch (error) {
        if (error.message === 'UNSUPPORTED_FILE_TYPE') {
            return res.status(400).json({ message: 'Unsupported file type. Only .pdf, .docx, .txt are accepted.' });
        }
        if (error.message === 'EMPTY_EXTRACTED_CONTENT') {
            return res.status(400).json({ message: 'No content extracted.' });
        }
        if (error.message === 'PDF_NO_TEXT_LAYER') {
            return res.status(400).json({ message: 'This PDF appears to be image-scanned (no text layer). Please OCR it first or upload a text-based PDF.' });
        }

        console.error('Error creating knowledge:', error);
        return res.status(500).json({ message: 'Server error.' });
    }
};

const updateKnowledge = async (req, res) => {
    try {
        const { id } = req.params;
        const { content, category, source_document } = req.body;
        if (!content) return res.status(400).json({ message: 'Content required.' });

        const embedding = await aiService.generateEmbedding(content, TaskType.RETRIEVAL_DOCUMENT);
        const updated = await knowledgeModel.update(id, { content, category, source_document, embedding });

        if (!updated) return res.status(404).json({ message: 'Not found.' });
        return res.status(200).json(updated);
    } catch (error) {
        return res.status(500).json({ message: 'Server error.' });
    }
};

const deleteKnowledge = async (req, res) => {
    try {
        await knowledgeModel.remove(req.params.id);
        return res.status(200).json({ message: 'Deleted.' });
    } catch (error) {
        return res.status(500).json({ message: 'Server error.' });
    }
};

const getKnowledgeList = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 15;
        const result = await knowledgeModel.findAll(page, limit);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ message: 'Server error.' });
    }
};

const getKnowledgeSources = async (req, res) => {
    try {
        const sources = await knowledgeModel.getSourcesSummary();
        return res.status(200).json({ sources, total_sources: sources.length });
    } catch (error) {
        console.error('Error getting knowledge sources:', error);
        return res.status(500).json({ message: 'Server error.' });
    }
};

const getKnowledgeById = async (req, res) => {
    try {
        const knowledge = await knowledgeModel.findById(req.params.id);
        if (!knowledge) return res.status(404).json({ message: 'Not found.' });
        return res.status(200).json(knowledge);
    } catch (error) {
        return res.status(500).json({ message: 'Server error.' });
    }
};

const createKnowledgeFromText = async (req, res) => {
    try {
        let { text, chunks, category, source_document } = req.body;
        const replaceExisting = toBoolean(req.body.replaceExisting);

        if (!source_document) {
            return res.status(400).json({ message: 'source_document required.' });
        }

        if (text && (!chunks || chunks.length === 0)) {
            chunks = generateKnowledgeChunks(text);
        }

        if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
            return res.status(400).json({ message: 'Dữ liệu không hợp lệ.' });
        }

        const { ingestedChunks } = await ingestChunksToKnowledge({
            chunks,
            category,
            sourceDocument: source_document,
            replaceExisting,
        });

        return res.status(201).json({
            message: `Ingested ${ingestedChunks.length} chunks from text.`,
            ingested_count: ingestedChunks.length,
            replaceExisting,
            chunks: ingestedChunks,
        });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ message: 'Server error.' });
    }
};

module.exports = {
    ingestUploadedKnowledgeFile,
    createKnowledge,
    updateKnowledge,
    deleteKnowledge,
    getKnowledgeList,
    getKnowledgeSources,
    getKnowledgeById,
    createKnowledgeFromText,
    extractTextFromKnowledgeFile,
};
