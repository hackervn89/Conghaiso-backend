const express = require('express');
const router = express.Router();
const knowledgeController = require('../controllers/knowledgeController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// Áp dụng middleware bảo vệ và kiểm tra quyền admin cho tất cả các route bên dưới
router.use(authenticate, authorize(['Admin']));

// [NEW] Route để ingest các chunk văn bản đã được chia thủ công
router.post('/from-text', knowledgeController.createKnowledgeFromText);

router.route('/')
    .post(knowledgeController.createKnowledge)
    .get(knowledgeController.getKnowledgeList);

router.route('/:id')
    .get(knowledgeController.getKnowledgeById)
    .put(knowledgeController.updateKnowledge)
    .delete(knowledgeController.deleteKnowledge);

module.exports = router;