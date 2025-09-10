const express = require('express');
const {
  createUserByAdmin,
  getAllUsers,
  getUserDetails, // <-- Import hàm mới
  updateUser,
  deleteUser,
  getUsersGrouped,
  savePushToken,
} = require('../controllers/userController');
const { protect, isAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/grouped', protect, getUsersGrouped);
router.post('/push-token', protect, savePushToken);

router.route('/')
  .post(protect, isAdmin, createUserByAdmin)
  .get(protect, isAdmin, getAllUsers);

router.route('/:id')
  .get(protect, isAdmin, getUserDetails) // <-- Thêm phương thức GET
  .put(protect, isAdmin, updateUser)
  .delete(protect, isAdmin, deleteUser);

module.exports = router;