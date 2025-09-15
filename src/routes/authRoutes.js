const express = require('express');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// @route   POST /api/auth/login
router.post('/login', authController.login);
router.post('/logout', protect, authController.logout);

// @route   GET /api/auth/me
// Middleware 'protect' sẽ chạy trước, sau đó mới đến controller 'getMe'
router.get('/me', protect, authController.getMe);

module.exports = router;
