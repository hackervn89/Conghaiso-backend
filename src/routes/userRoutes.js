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
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/grouped', authenticate, getUsersGrouped);
router.post('/push-token', authenticate, savePushToken);

// Route mới để lấy danh sách đồng nghiệp
router.get('/colleagues', authenticate, getColleagues); 

router.route('/')
  .post(authenticate, authorize(['Admin']), createUserByAdmin)
  .get(authenticate, authorize(['Admin']), getAllUsers);

router.route('/:id')
  .get(authenticate, authorize(['Admin']), getUserDetails)
  .put(authenticate, authorize(['Admin']), updateUser)
  .delete(authenticate, authorize(['Admin']), deleteUser);

module.exports = router;