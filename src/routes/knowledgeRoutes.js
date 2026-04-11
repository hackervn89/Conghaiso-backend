const express = require('express');
const multer = require('multer');
const router = express.Router();
const knowledgeController = require('../controllers/knowledgeController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

// Áp dụng middleware bảo vệ và kiểm tra quyền admin cho tất cả các route bên dưới
router.use(authenticate, authorize(['Admin']));

// Route dễ dùng: upload trực tiếp 1 file và ingest ngay
router.post('/ingest-file', upload.single('document'), knowledgeController.ingestUploadedKnowledgeFile);

// Thống kê nguồn tài liệu đã nạp
router.get('/sources', knowledgeController.getKnowledgeSources);

// Nạp tri thức từ text/chunks thủ công
router.post('/from-text', knowledgeController.createKnowledgeFromText);

router.route('/')
    .post(knowledgeController.createKnowledge)
    .get(knowledgeController.getKnowledgeList);

router.route('/:id')
    .get(knowledgeController.getKnowledgeById)
    .put(knowledgeController.updateKnowledge)
    .delete(knowledgeController.deleteKnowledge);

module.exports = router;
