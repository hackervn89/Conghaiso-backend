const path = require('path');
const fs = require('fs');
const adminDocumentModel = require('../models/adminDocumentModel');
const { reingestAdminDocumentByCode } = require('../services/knowledgeIngestService');

const getAdminDocuments = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const docType = req.query.docType || null;
        const search = req.query.search || '';

        const result = await adminDocumentModel.findAll({ page, limit, docType, search });
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error getting admin documents:', error);
        return res.status(500).json({ message: 'Server error.' });
    }
};

const getAdminDocumentByCode = async (req, res) => {
    try {
        const document = await adminDocumentModel.findByCode(req.params.documentCode);
        if (!document) {
            return res.status(404).json({ message: 'Không tìm thấy tài liệu.' });
        }
        return res.status(200).json(document);
    } catch (error) {
        console.error('Error getting admin document by code:', error);
        return res.status(500).json({ message: 'Server error.' });
    }
};

const downloadAdminDocument = async (req, res) => {
    try {
        const document = await adminDocumentModel.findByCode(req.params.documentCode);
        if (!document) {
            return res.status(404).json({ message: 'Không tìm thấy tài liệu.' });
        }

        if (!document.file_path) {
            return res.status(404).json({ message: 'Tài liệu chưa có đường dẫn file gốc.' });
        }

        const absolutePath = path.resolve(document.file_path);
        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ message: 'File gốc không tồn tại trên hệ thống.' });
        }

        return res.download(absolutePath, document.file_name || path.basename(absolutePath));
    } catch (error) {
        console.error('Error downloading admin document:', error);
        return res.status(500).json({ message: 'Server error.' });
    }
};

const reingestAdminDocument = async (req, res) => {
    try {
        const { documentCode } = req.params;
        await adminDocumentModel.updateIngestStatus(documentCode, 'processing', null);
        const result = await reingestAdminDocumentByCode(documentCode);

        return res.status(200).json({
            message: `Đã nạp lại tri thức cho tài liệu ${documentCode}.`,
            document_code: documentCode,
            chunk_count: result.chunks.length,
            ingested_count: result.ingestedChunks.length,
            file_url: result.document.file_url,
        });
    } catch (error) {
        const { documentCode } = req.params;
        await adminDocumentModel.updateIngestStatus(documentCode, 'failed', error.message).catch(() => null);

        if (error.message === 'DOCUMENT_NOT_FOUND') {
            return res.status(404).json({ message: 'Không tìm thấy metadata tài liệu.' });
        }
        if (error.message === 'DOCUMENT_FILE_PATH_MISSING') {
            return res.status(400).json({ message: 'Tài liệu chưa có đường dẫn file gốc.' });
        }
        if (error.message === 'UNSUPPORTED_FILE_TYPE') {
            return res.status(400).json({ message: 'Định dạng file không được hỗ trợ để nạp tri thức.' });
        }
        if (error.message === 'PDF_NO_TEXT_LAYER') {
            return res.status(400).json({ message: 'PDF này có thể là file scan ảnh. Hãy OCR trước khi nạp tri thức.' });
        }
        if (error.message === 'EMPTY_EXTRACTED_CONTENT') {
            return res.status(400).json({ message: 'Không trích xuất được nội dung từ tài liệu.' });
        }

        console.error('Error reingesting admin document:', error);
        return res.status(500).json({ message: 'Đã có lỗi xảy ra khi nạp lại tri thức cho tài liệu.' });
    }
};

module.exports = {
    getAdminDocuments,
    getAdminDocumentByCode,
    downloadAdminDocument,
    reingestAdminDocument,
};
