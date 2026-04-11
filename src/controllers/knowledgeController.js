const knowledgeModel = require('../models/knowledgeModel');
const aiService = require('../services/aiService');
const storageService = require('../services/storageService');
const { generateKnowledgeChunks } = require('../services/chunkingService');
const fs = require('fs/promises');
const pdf = require('pdf-extraction');
const mammoth = require('mammoth');
const path = require('path');
const { TaskType } = require('@google/generative-ai');

const SUPPORTED_KNOWLEDGE_EXTENSIONS = new Set(['.docx', '.pdf', '.txt']);

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    return false;
};

const sanitizeChunk = (chunk) => chunk.replace(/\x00/g, '').trim();

const decodeFilename = (filename = '') => {
    try {
        return Buffer.from(filename, 'latin1').toString('utf8');
    } catch {
        return filename;
    }
};

async function extractTextFromKnowledgeFile(absoluteFilePath, sourceFilename) {
    const fileExtension = path.extname(sourceFilename).toLowerCase();

    if (!SUPPORTED_KNOWLEDGE_EXTENSIONS.has(fileExtension)) {
        throw new Error('UNSUPPORTED_FILE_TYPE');
    }

    if (fileExtension === '.docx') {
        const result = await mammoth.extractRawText({ path: absoluteFilePath });
        return result.value;
    }

    if (fileExtension === '.pdf') {
        const dataBuffer = await fs.readFile(absoluteFilePath);
        const data = await pdf(dataBuffer);
        return data.text;
    }

    return fs.readFile(absoluteFilePath, 'utf-8');
}

async function ingestChunksToKnowledge({ chunks, category, sourceDocument, replaceExisting = false }) {
    const sanitizedChunks = chunks.map(sanitizeChunk).filter(Boolean);
    if (sanitizedChunks.length === 0) return { ingestedChunks: [], removedCount: 0 };

    if (replaceExisting) {
        await knowledgeModel.removeBySourceDocument(sourceDocument);
    }

    const embeddings = await aiService.generateEmbedding(sanitizedChunks, TaskType.RETRIEVAL_DOCUMENT);

    const rowsToInsert = sanitizedChunks.map((content, index) => ({
        content,
        category: category || 'Uncategorized',
        source_document: sourceDocument,
        embedding: embeddings[index],
    }));

    const ingestedChunks = await knowledgeModel.createMany(rowsToInsert);
    return {
        ingestedChunks,
        removedCount: replaceExisting ? rowsToInsert.length : 0,
    };
}

async function ingestContent({ content, category, sourceDocument, replaceExisting = false }) {
    const chunks = generateKnowledgeChunks(content);
    if (chunks.length === 0) {
        throw new Error('EMPTY_EXTRACTED_CONTENT');
    }

    const { ingestedChunks } = await ingestChunksToKnowledge({
        chunks,
        category,
        sourceDocument,
        replaceExisting,
    });

    return { chunks, ingestedChunks };
}

async function ingestFromTempPath({ tempFilePath, category, replaceExisting = false }) {
    const { finalPath, originalName } = await storageService.moveFileToKnowledgeFolder(tempFilePath);
    const absoluteFilePath = path.join(storageService.STORAGE_BASE_PATH, finalPath);

    const fileContent = await extractTextFromKnowledgeFile(absoluteFilePath, originalName);
    return ingestContent({
        content: fileContent,
        category,
        sourceDocument: originalName,
        replaceExisting,
    });
}

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
};
