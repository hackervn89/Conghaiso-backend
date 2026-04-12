const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const adminDocumentController = require('../controllers/adminDocumentController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

const adminDocsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.ADMIN_DOCS_RATE_LIMIT_MAX || 600),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        if (req.user?.id) return `admin-docs-user-${req.user.id}`;
        if (req.user?.userId) return `admin-docs-user-${req.user.userId}`;
        return req.ip;
    },
    message: { message: 'Bạn thao tác quá nhanh ở module Văn bản gốc, vui lòng thử lại sau ít phút.' },
});

router.use(authenticate, authorize(['Admin']), adminDocsLimiter);

router.get('/summary', adminDocumentController.getAdminDocumentsSummary);
router.post('/import-metadata', upload.single('metadataFile'), adminDocumentController.importAdminDocumentMetadata);
router.post('/upload-file/:documentCode', upload.single('document'), adminDocumentController.uploadAdminDocumentFile);
router.patch('/status/:documentCode', adminDocumentController.updateAdminDocumentStatuses);
router.post('/reingest-batch', adminDocumentController.reingestAdminDocumentsBatch);
router.post('/reingest/:documentCode', adminDocumentController.reingestAdminDocument);
router.get('/download/:documentCode', adminDocumentController.downloadAdminDocument);
router.get('/:documentCode', adminDocumentController.getAdminDocumentByCode);
router.get('/', adminDocumentController.getAdminDocuments);

module.exports = router;
