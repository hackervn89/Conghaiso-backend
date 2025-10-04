const express = require('express');
const {
    getTasks,
    getTaskById,
    createTask,
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
    .delete(deleteTask);

router.put('/:id/status', updateTaskStatus);


module.exports = router;