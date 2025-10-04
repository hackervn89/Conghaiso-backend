const express = require('express');
const { getDashboardStats } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/stats', authenticate, getDashboardStats);

module.exports = router;