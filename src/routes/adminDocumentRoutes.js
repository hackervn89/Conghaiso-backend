const express = require('express');
const multer = require('multer');
const router = express.Router();
const adminDocumentController = require('../controllers/adminDocumentController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate, authorize(['Admin']));

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
