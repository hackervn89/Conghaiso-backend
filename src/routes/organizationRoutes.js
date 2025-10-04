const express = require('express');
const router = express.Router();
const organizationController = require('../controllers/organizationController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// Routes cho quản lý đơn vị
router.get('/', authenticate, organizationController.getAllOrgs);
router.get('/tree', authenticate, organizationController.getOrgTree);
router.get('/:id', authenticate, organizationController.getOrgById);
router.post('/', authenticate, authorize(['Admin']), organizationController.createOrg);
router.put('/:id', authenticate, authorize(['Admin']), organizationController.updateOrg);
router.delete('/:id', authenticate, authorize(['Admin']), organizationController.deleteOrg);

// Routes cho quản lý thành viên trong đơn vị
router.get('/:orgId/users', authenticate, organizationController.getUsersByOrg);
router.post('/:orgId/users', authenticate, authorize(['Admin']), organizationController.addUserToOrg);
router.delete('/:orgId/users/:userId', authenticate, authorize(['Admin']), organizationController.removeUserFromOrg);

// === CÁC ROUTE ĐỂ QUẢN LÝ LÃNH ĐẠO ===

// Lấy danh sách lãnh đạo của một đơn vị
router.get('/:orgId/leaders', authenticate, organizationController.getOrgLeaders);

// Thêm một lãnh đạo (chỉ Admin)
router.post('/:orgId/leaders', authenticate, authorize(['Admin']), organizationController.addOrgLeader);

// Xóa một lãnh đạo (chỉ Admin)
router.delete('/:orgId/leaders/:userId', authenticate, authorize(['Admin']), organizationController.removeOrgLeader);

module.exports = router;

