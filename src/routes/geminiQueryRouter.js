const express = require('express');
const router = express.Router();
const geminiQueryRouterController = require('../controllers/geminiQueryRouterController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/route-query', authenticate, geminiQueryRouterController.routeQuery);

module.exports = router;