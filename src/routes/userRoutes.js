const express = require('express');
const {
  createUserByAdmin,
  getAllUsers,
  getUserDetails,
  updateUser,
  deleteUser,
  getUsersGrouped,
  savePushToken,
  getColleagues, // Import hàm mới
} = require('../controllers/userController');
const { protect, isAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/grouped', protect, getUsersGrouped);
router.post('/push-token', protect, savePushToken);

// Route mới để lấy danh sách đồng nghiệp
router.get('/colleagues', protect, getColleagues); 

router.route('/')
  .post(protect, isAdmin, createUserByAdmin)
  .get(protect, isAdmin, getAllUsers);

router.route('/:id')
  .get(protect, isAdmin, getUserDetails)
  .put(protect, isAdmin, updateUser)
  .delete(protect, isAdmin, deleteUser);

module.exports = router;

