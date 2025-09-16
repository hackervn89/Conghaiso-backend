const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware'); // Assuming authentication is needed

// GET /api/reports/tasks-by-organization
router.get('/tasks-by-organization', protect, reportController.getTasksByOrganizationReport);

module.exports = router;
