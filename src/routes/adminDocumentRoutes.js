const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const adminDocumentController = require('../controllers/adminDocumentController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

const buildAdminDocsKey = (req) => {
    if (req.user?.id) return `admin-docs-user-${req.user.id}`;
    if (req.user?.userId) return `admin-docs-user-${req.user.userId}`;
    return req.ip;
};

const adminDocsWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.ADMIN_DOCS_WRITE_RATE_LIMIT_MAX || 120),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: buildAdminDocsKey,
    message: { message: 'Bạn thao tác quá nhanh ở module Văn bản gốc, vui lòng thử lại sau ít phút.' },
});

router.use(authenticate, authorize(['Admin']));

router.get('/summary', adminDocumentController.getAdminDocumentsSummary);
router.post('/import-metadata', adminDocsWriteLimiter, upload.single('metadataFile'), adminDocumentController.importAdminDocumentMetadata);
router.post('/upload-file/:documentCode', adminDocsWriteLimiter, upload.single('document'), adminDocumentController.uploadAdminDocumentFile);
router.patch('/status/:documentCode', adminDocsWriteLimiter, adminDocumentController.updateAdminDocumentStatuses);
router.post('/reingest-batch', adminDocsWriteLimiter, adminDocumentController.reingestAdminDocumentsBatch);
router.post('/reingest/:documentCode', adminDocsWriteLimiter, adminDocumentController.reingestAdminDocument);
router.get('/download/:documentCode', adminDocumentController.downloadAdminDocument);
router.get('/:documentCode', adminDocumentController.getAdminDocumentByCode);
router.get('/', adminDocumentController.getAdminDocuments);

module.exports = router;
