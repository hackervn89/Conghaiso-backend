const express = require('express');
const router = express.Router();
const draftController = require('../controllers/draftController');
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');

// Cấu hình multer để lưu file vào bộ nhớ tạm thời
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Endpoint 1: Tạo Luồng Góp Ý Mới
router.post('/', protect, upload.single('document'), draftController.createDraft);

// Endpoint 2: Lấy Danh Sách Dự Thảo
router.get('/', protect, draftController.getDrafts);

// Endpoint 3: Lấy Chi Tiết Một Dự Thảo
router.get('/:id', protect, draftController.getDraftById);

// Endpoint 4: Gửi Ý Kiến Góp Ý
router.post('/:id/comment', protect, draftController.addComment);

// Endpoint 5: Xác Nhận "Thống Nhất"
router.post('/:id/agree', protect, draftController.agreeToDraft);


module.exports = router;