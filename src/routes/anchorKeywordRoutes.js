const express = require('express');
const router = express.Router();
const anchorKeywordController = require('../controllers/anchorKeywordController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// Tất cả các route trong file này đều yêu cầu đăng nhập và có quyền Admin
router.use(authenticate, authorize(['Admin']));

router.route('/')
    .get(anchorKeywordController.getAllKeywords)
    .post(anchorKeywordController.createKeyword);

router.route('/:id')
    .put(anchorKeywordController.updateKeyword)
    .delete(anchorKeywordController.deleteKeyword);

module.exports = router;