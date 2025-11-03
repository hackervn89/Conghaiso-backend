const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticate } = require('../middleware/authMiddleware');

// Tất cả các route trong file này đều yêu cầu người dùng phải đăng nhập.
router.use(authenticate);

// Lấy danh sách tất cả các phiên trò chuyện của người dùng.
router.get('/sessions', chatController.listSessions);

// Lấy tất cả tin nhắn của một phiên trò chuyện cụ thể.
router.get('/sessions/:sessionId', chatController.getSessionMessages);

// Xóa một phiên trò chuyện.
router.delete('/sessions/:sessionId', chatController.deleteSession);

module.exports = router;