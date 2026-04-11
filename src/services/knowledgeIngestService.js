const fs = require('fs/promises');
const path = require('path');
const pdf = require('pdf-extraction');
const mammoth = require('mammoth');
const { TaskType } = require('@google/generative-ai');
const aiService = require('./aiService');
const storageService = require('./storageService');
const knowledgeModel = require('../models/knowledgeModel');
const adminDocumentModel = require('../models/adminDocumentModel');
const { generateKnowledgeChunks } = require('./chunkingService');

const SUPPORTED_KNOWLEDGE_EXTENSIONS = new Set(['.docx', '.pdf', '.txt']);

const sanitizeChunk = (chunk) => chunk.replace(/\x00/g, '').trim();

function normalizeExtractedText(text = '') {
    return text
        .replace(/\x00/g, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function extractTextFromKnowledgeFile(absoluteFilePath, sourceFilename) {
    const fileExtension = path.extname(sourceFilename).toLowerCase();

    if (!SUPPORTED_KNOWLEDGE_EXTENSIONS.has(fileExtension)) {
        throw new Error('UNSUPPORTED_FILE_TYPE');
    }

    if (fileExtension === '.docx') {
        const result = await mammoth.extractRawText({ path: absoluteFilePath });
        const normalized = normalizeExtractedText(result.value || '');
        if (!normalized) throw new Error('EMPTY_EXTRACTED_CONTENT');
        return normalized;
    }

    if (fileExtension === '.pdf') {
        const dataBuffer = await fs.readFile(absoluteFilePath);
        const data = await pdf(dataBuffer);
        const normalized = normalizeExtractedText(data.text || '');
        if (!normalized || normalized.length < 30) {
            throw new Error('PDF_NO_TEXT_LAYER');
        }
        return normalized;
    }

    const txtContent = await fs.readFile(absoluteFilePath, 'utf-8');
    const normalized = normalizeExtractedText(txtContent);
    if (!normalized) throw new Error('EMPTY_EXTRACTED_CONTENT');
    return normalized;
}

function buildChunkPrefix({ documentCode, docType, symbol, summary, issuer, issuedDate }) {
    const parts = [
        documentCode ? `Mã tài liệu: ${documentCode}` : null,
        docType ? `Loại văn bản: ${docType}` : null,
        symbol ? `Số ký hiệu: ${symbol}` : null,
        issuer ? `Cơ quan ban hành: ${issuer}` : null,
        issuedDate ? `Ngày ban hành: ${issuedDate}` : null,
        summary ? `Trích yếu: ${summary}` : null,
    ].filter(Boolean);

    return parts.length ? `${parts.join('\n')}\n` : '';
}

async function ingestChunksToKnowledge({ chunks, category, sourceDocument, replaceExisting = false }) {
    const sanitizedChunks = chunks.map(sanitizeChunk).filter(Boolean);
    if (sanitizedChunks.length === 0) return { ingestedChunks: [], removedCount: 0 };

    let removedCount = 0;
    if (replaceExisting) {
        removedCount = await knowledgeModel.removeBySourceDocument(sourceDocument);
    }

    const embeddings = await aiService.generateEmbedding(sanitizedChunks, TaskType.RETRIEVAL_DOCUMENT);
    const rowsToInsert = sanitizedChunks.map((content, index) => ({
        content,
        category: category || 'Uncategorized',
        source_document: sourceDocument,
        embedding: embeddings[index],
    }));

    const ingestedChunks = await knowledgeModel.createMany(rowsToInsert);
    return { ingestedChunks, removedCount };
}

async function ingestContent({ content, category, sourceDocument, replaceExisting = false, metadata = null }) {
    const rawChunks = generateKnowledgeChunks(content);
    if (rawChunks.length === 0) {
        throw new Error('EMPTY_EXTRACTED_CONTENT');
    }

    const prefix = metadata ? buildChunkPrefix(metadata) : '';
    const chunks = prefix ? rawChunks.map(chunk => `${prefix}Nội dung: ${chunk}`) : rawChunks;

    const { ingestedChunks, removedCount } = await ingestChunksToKnowledge({
        chunks,
        category,
        sourceDocument,
        replaceExisting,
    });

    return { chunks, ingestedChunks, removedCount };
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

async function reingestAdminDocumentByCode(documentCode) {
    const document = await adminDocumentModel.findByCode(documentCode);
    if (!document) throw new Error('DOCUMENT_NOT_FOUND');
    if (!document.file_path) throw new Error('DOCUMENT_FILE_PATH_MISSING');

    const absoluteFilePath = path.resolve(document.file_path);
    const fileContent = await extractTextFromKnowledgeFile(absoluteFilePath, document.file_name || `${document.document_code}.pdf`);

    const result = await ingestContent({
        content: fileContent,
        category: document.doc_type,
        sourceDocument: document.document_code,
        replaceExisting: true,
        metadata: {
            documentCode: document.document_code,
            docType: document.doc_type,
            symbol: document.symbol,
            summary: document.summary || document.abstract,
            issuer: document.issuer,
            issuedDate: document.issued_date,
        },
    });

    await adminDocumentModel.updateIngestStatus(document.document_code, 'ingested', null);
    return { document, ...result };
}

module.exports = {
    SUPPORTED_KNOWLEDGE_EXTENSIONS,
    normalizeExtractedText,
    extractTextFromKnowledgeFile,
    ingestChunksToKnowledge,
    ingestContent,
    ingestFromTempPath,
    reingestAdminDocumentByCode,
};
