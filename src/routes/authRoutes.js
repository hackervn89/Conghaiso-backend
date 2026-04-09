const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const { loginSchema } = require('../middleware/schemas/authSchema');

const router = express.Router();

// @route   POST /api/auth/login
// [CẢI TIẾN] Thêm validate(loginSchema) để kiểm tra input trước khi xử lý
router.post('/login', validate(loginSchema), authController.login);
router.post('/logout', authenticate, authController.logout);

// @route   GET /api/auth/me
router.get('/me', authenticate, authController.getMe);

module.exports = router;