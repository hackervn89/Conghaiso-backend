const express = require('express');
const { getDashboardStats } = require('../controllers/dashboardController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// @route   GET /api/dashboard/stats
// Lấy các số liệu thống kê cho trang Dashboard
router.get('/stats', protect, getDashboardStats);

module.exports = router;