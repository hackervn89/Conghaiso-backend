const express = require('express');
const {
    createTask,
    getTasks,
    getTaskById,
    updateTask,
    updateTaskStatus,
    deleteTask,
} = require('../controllers/taskController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// Tất cả các route trong file này đều yêu cầu người dùng phải đăng nhập
router.use(authenticate);

router.route('/')
    .get(getTasks)
    .post(createTask);

router.route('/:id')
    .get(getTaskById)
    .put(updateTask) // Thêm dòng này để xử lý việc cập nhật công việc
    .delete(deleteTask);

router.put('/:id/status', updateTaskStatus);


module.exports = router;