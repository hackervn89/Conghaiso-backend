const express = require('express');
const fileController = require('../controllers/fileController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Route này được bảo vệ, người dùng phải đăng nhập để truy cập tệp.
// Controller sẽ xử lý các kiểm tra quyền chi tiết hơn.
router.get('/view', protect, fileController.serveFile);

module.exports = router;
