const express = require('express');
const multer = require('multer');
const { uploadDocument } = require('../controllers/uploadController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

// @route   POST /api/upload
// Tải một hoặc nhiều file tài liệu lên thư mục gốc tạm thời
router.post('/', authenticate, upload.array('documents', 5), uploadDocument);

module.exports = router;