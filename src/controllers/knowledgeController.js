const knowledgeModel = require('../models/knowledgeModel');
const aiService = require('../services/aiService');
const storageService = require('../services/storageService');
const { generateKnowledgeChunks } = require('../services/chunkingService');
const fs = require('fs/promises');
const pdf = require('pdf-extraction');
const mammoth = require('mammoth');
const path = require('path');
const { TaskType } = require('@google/generative-ai');

async function ingestChunksToKnowledge({ chunks, category, sourceDocument }) {
    const sanitizedChunks = chunks.map(c => c.replace(/\x00/g, '').trim()).filter(Boolean);
    if (sanitizedChunks.length === 0) return [];

    const embeddings = await aiService.generateEmbedding(sanitizedChunks, TaskType.RETRIEVAL_DOCUMENT);

    const ingestedChunks = [];
    for (let i = 0; i < sanitizedChunks.length; i++) {
        const newKnowledge = await knowledgeModel.create({
            content: sanitizedChunks[i],
            category: category || 'Uncategorized',
            source_document: sourceDocument,
            embedding: embeddings[i]
        });
        ingestedChunks.push(newKnowledge);
    }

    return ingestedChunks;
}

const createKnowledge = async (req, res) => {
    try {
        const { category, tempFilePath } = req.body;
        if (!tempFilePath) return res.status(400).json({ message: 'tempFilePath is required.' });

        const { finalPath, originalName } = await storageService.moveFileToKnowledgeFolder(tempFilePath);
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
            return res.status(400).json({ message: 'Unsupported file type.' });
        }

        const chunks = generateKnowledgeChunks(fileContent);

        if (chunks.length === 0) return res.status(400).json({ message: 'No content extracted.' });

        console.log(`[Knowledge] Creating embeddings for ${chunks.length} chunks...`);
        const ingestedChunks = await ingestChunksToKnowledge({
            chunks,
            category,
            sourceDocument: originalName,
        });

        res.status(201).json({ message: `Ingested ${ingestedChunks.length} chunks.`, chunks: ingestedChunks });
    } catch (error) {
        console.error('Error creating knowledge:', error);
        res.status(500).json({ message: 'Server error.' });
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
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const deleteKnowledge = async (req, res) => {
    try {
        await knowledgeModel.remove(req.params.id);
        res.status(200).json({ message: 'Deleted.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const getKnowledgeList = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 15;
        const result = await knowledgeModel.findAll(page, limit);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const getKnowledgeById = async (req, res) => {
    try {
        const knowledge = await knowledgeModel.findById(req.params.id);
        if (!knowledge) return res.status(404).json({ message: 'Not found.' });
        res.status(200).json(knowledge);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const createKnowledgeFromText = async (req, res) => {
    try {
        let { text, chunks, category, source_document } = req.body;

        if (text && (!chunks || chunks.length === 0)) {
            console.log('[Manual Input] Đang chia nhỏ văn bản thủ công bằng chunking service...');
            chunks = generateKnowledgeChunks(text);
        }

        if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
            return res.status(400).json({ message: 'Dữ liệu không hợp lệ.' });
        }
        if (!source_document) return res.status(400).json({ message: 'source_document required.' });

        console.log(`[From Text] Embedding ${chunks.length} chunks...`);
        const ingestedChunks = await ingestChunksToKnowledge({
            chunks,
            category,
            sourceDocument: source_document,
        });

        res.status(201).json({ message: `Ingested ${ingestedChunks.length} chunks from text.`, chunks: ingestedChunks });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
};

module.exports = { createKnowledge, updateKnowledge, deleteKnowledge, getKnowledgeList, getKnowledgeById, createKnowledgeFromText };
