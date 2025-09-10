const express = require('express');
const { getOrganizations, createOrganization, updateOrganization, deleteOrganization } = require('../controllers/organizationController');
const { protect, isAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

// Tất cả các route đều yêu cầu đăng nhập
router.use(protect);

// Lấy danh sách (dành cho mọi người)
router.get('/', getOrganizations);

// Các thao tác quản trị (chỉ dành cho Admin)
router.post('/', isAdmin, createOrganization);
router.put('/:id', isAdmin, updateOrganization);
router.delete('/:id', isAdmin, deleteOrganization);

module.exports = router;
