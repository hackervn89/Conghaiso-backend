const express = require('express');
const router = express.Router();
const geminiController = require('../controllers/geminiController');
const { authenticate } = require('../middleware/authMiddleware');

// Endpoint này chỉ yêu cầu người dùng đã đăng nhập
router.post('/chat', authenticate, geminiController.chatWithAI);

module.exports = router;