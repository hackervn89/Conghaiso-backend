const express = require('express');
const router = express.Router();
const adminDocumentController = require('../controllers/adminDocumentController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.get('/download/:documentCode', authenticate, adminDocumentController.downloadAdminDocument);
router.post('/reingest/:documentCode', authenticate, authorize(['Admin']), adminDocumentController.reingestAdminDocument);
router.get('/:documentCode', authenticate, adminDocumentController.getAdminDocumentByCode);
router.get('/', authenticate, authorize(['Admin']), adminDocumentController.getAdminDocuments);

module.exports = router;
