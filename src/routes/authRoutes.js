const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// @route   POST /api/auth/login
router.post('/login', authController.login);
router.post('/logout', authenticate, authController.logout);

// @route   GET /api/auth/me
// Middleware 'authenticate' sẽ chạy trước, sau đó mới đến controller 'getMe'
router.get('/me', authenticate, authController.getMe);

module.exports = router;