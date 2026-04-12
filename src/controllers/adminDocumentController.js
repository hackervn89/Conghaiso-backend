const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const xlsx = require('xlsx');
const adminDocumentModel = require('../models/adminDocumentModel');
const storageService = require('../services/storageService');
const {
    extractTextFromKnowledgeFile,
    reingestAdminDocumentByCode,
} = require('../services/knowledgeIngestService');
const {
    resolveDataRoot,
    normalizeTargetSheets,
    importAdminDocumentsFromWorkbook,
} = require('../services/adminDocumentImportService');

const decodeFilename = (filename = '') => {
    try {
        return Buffer.from(filename, 'latin1').toString('utf8');
    } catch {
        return filename;
    }
};

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    return false;
};

const getAdminDocuments = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const docType = req.query.docType || null;
        const search = req.query.search || '';
        const ingestStatus = req.query.ingestStatus || null;
        const ocrStatus = req.query.ocrStatus || null;
        const hasFile = typeof req.query.hasFile === 'string' ? toBoolean(req.query.hasFile) : null;

        const [result, stats, docTypes] = await Promise.all([
            adminDocumentModel.findAll({ page, limit, docType, search, ingestStatus, ocrStatus, hasFile }),
            adminDocumentModel.getStats(),
            adminDocumentModel.getDocTypes(),
        ]);

        return res.status(200).json({
            ...result,
            stats,
            filters: {
                docTypes,
                ingestStatuses: ['pending', 'processing', 'ingested', 'failed'],
                ocrStatuses: ['pending', 'required', 'done', 'failed'],
            },
        });
    } catch (error) {
        console.error('Error getting admin documents:', error);
        return res.status(500).json({ message: 'Server error.' });
    }
};

const getAdminDocumentsSummary = async (_req, res) => {
    try {
        const [stats, docTypes] = await Promise.all([
            adminDocumentModel.getStats(),
            adminDocumentModel.getDocTypes(),
        ]);

        return res.status(200).json({ stats, docTypes });
    } catch (error) {
        console.error('Error getting admin documents summary:', error);
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

const importAdminDocumentMetadata = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Vui lòng chọn file Excel metadata (field: metadataFile).' });
        }

        const targetSheets = normalizeTargetSheets(req.body.targetSheets);
        const customDataRoot = req.body.dataRoot || null;
        const resolvedDataRoot = await resolveDataRoot(customDataRoot);
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const result = await importAdminDocumentsFromWorkbook({
            workbook,
            dataRoot: resolvedDataRoot,
            targetSheets,
        });

        const stats = await adminDocumentModel.getStats();

        return res.status(200).json({
            message: 'Đã import metadata tài liệu từ Excel.',
            ...result,
            stats,
            dataRootResolved: resolvedDataRoot,
            dataRootProvided: customDataRoot,
            warning: resolvedDataRoot
                ? null
                : 'Không tìm thấy thư mục file gốc. Metadata vẫn đã import, nhưng các tài liệu chưa được map file tự động.',
        });
    } catch (error) {
        console.error('Error importing admin document metadata:', error);
        return res.status(500).json({ message: 'Đã có lỗi khi import metadata từ Excel.' });
    }
};

const uploadAdminDocumentFile = async (req, res) => {
    try {
        const { documentCode } = req.params;
        const document = await adminDocumentModel.findByCode(documentCode);

        if (!document) {
            return res.status(404).json({ message: 'Không tìm thấy tài liệu để gắn file gốc.' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Vui lòng chọn file gốc cần tải lên (field: document).' });
        }

        const uploadFile = {
            ...req.file,
            originalname: decodeFilename(req.file.originalname),
        };

        const tempPath = await storageService.saveFileToTempFolder(uploadFile);
        const finalRelativePath = path.join('admin-documents', documentCode, path.basename(tempPath)).replace(/\\/g, '/');
        const absoluteFinalPath = path.join(storageService.STORAGE_BASE_PATH, finalRelativePath);

        await fsPromises.mkdir(path.dirname(absoluteFinalPath), { recursive: true });
        await fsPromises.copyFile(path.join(storageService.STORAGE_BASE_PATH, tempPath), absoluteFinalPath);
        await fsPromises.unlink(path.join(storageService.STORAGE_BASE_PATH, tempPath));

        let detectedOcrStatus = 'pending';
        let detectedError = null;

        try {
            await extractTextFromKnowledgeFile(absoluteFinalPath, uploadFile.originalname);
            detectedOcrStatus = 'done';
        } catch (error) {
            if (error.message === 'PDF_NO_TEXT_LAYER') {
                detectedOcrStatus = 'required';
                detectedError = 'PDF scan ảnh, cần OCR trước khi ingest.';
            } else if (error.message === 'UNSUPPORTED_FILE_TYPE') {
                detectedOcrStatus = 'failed';
                detectedError = 'Định dạng file chưa hỗ trợ để ingest.';
            } else {
                detectedOcrStatus = 'failed';
                detectedError = 'Không kiểm tra được text layer của file.';
            }
        }

        const updated = await adminDocumentModel.updateFileInfo(documentCode, {
            file_name: uploadFile.originalname,
            file_path: absoluteFinalPath,
            file_url: `/api/admin-documents/download/${encodeURIComponent(documentCode)}`,
            ocr_status: detectedOcrStatus,
            ingest_status: 'pending',
            last_error: detectedError,
        });

        return res.status(200).json({
            message: `Đã tải file gốc cho tài liệu ${documentCode}.`,
            document: updated,
        });
    } catch (error) {
        console.error('Error uploading admin document file:', error);
        return res.status(500).json({ message: 'Đã có lỗi khi tải file gốc lên.' });
    }
};

const updateAdminDocumentStatuses = async (req, res) => {
    try {
        const { documentCode } = req.params;
        const { ocr_status, ingest_status, last_error } = req.body;

        const updated = await adminDocumentModel.updateStatuses(documentCode, {
            ocr_status: ocr_status || null,
            ingest_status: ingest_status || null,
            last_error: typeof last_error === 'string' ? last_error : null,
        });

        if (!updated) {
            return res.status(404).json({ message: 'Không tìm thấy tài liệu.' });
        }

        return res.status(200).json({
            message: 'Đã cập nhật trạng thái tài liệu.',
            document: updated,
        });
    } catch (error) {
        console.error('Error updating admin document statuses:', error);
        return res.status(500).json({ message: 'Đã có lỗi khi cập nhật trạng thái.' });
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

const reingestAdminDocumentsBatch = async (req, res) => {
    const { documentCodes } = req.body;

    if (!Array.isArray(documentCodes) || documentCodes.length === 0) {
        return res.status(400).json({ message: 'Vui lòng cung cấp danh sách documentCodes.' });
    }

    const normalizedCodes = [...new Set(documentCodes.map((code) => String(code || '').trim()).filter(Boolean))];
    if (normalizedCodes.length === 0) {
        return res.status(400).json({ message: 'Danh sách documentCodes không hợp lệ.' });
    }

    const successes = [];
    const failures = [];

    for (const documentCode of normalizedCodes) {
        try {
            await adminDocumentModel.updateIngestStatus(documentCode, 'processing', null);
            const result = await reingestAdminDocumentByCode(documentCode);
            successes.push({
                document_code: documentCode,
                chunk_count: result.chunks.length,
                ingested_count: result.ingestedChunks.length,
            });
        } catch (error) {
            await adminDocumentModel.updateIngestStatus(documentCode, 'failed', error.message).catch(() => null);
            failures.push({
                document_code: documentCode,
                error: error.message,
            });
        }
    }

    return res.status(200).json({
        message: `Hoàn tất batch re-ingest: thành công ${successes.length}, thất bại ${failures.length}.`,
        successes,
        failures,
    });
};

module.exports = {
    getAdminDocuments,
    getAdminDocumentsSummary,
    getAdminDocumentByCode,
    downloadAdminDocument,
    importAdminDocumentMetadata,
    uploadAdminDocumentFile,
    updateAdminDocumentStatuses,
    reingestAdminDocument,
    reingestAdminDocumentsBatch,
};
