const express = require('express');
const { summarizeDocument } = require('../controllers/summarizeController');
const router = express.Router();

router.post('/', summarizeDocument);

module.exports = router;