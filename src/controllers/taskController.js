const taskModel = require('../models/taskModel');
const db = require('../config/database'); // Import db để truy vấn

// Helper function to check permissions for modification/deletion
const canManageTask = (task, user) => {
    if (!task) return false;
    if (user.role === 'Admin') return true;
    return task.creator_id === user.user_id;
};

// SỬA LỖI 2: Helper function để kiểm tra quyền cập nhật trạng thái
const canUpdateTaskStatus = async (task, user) => {
    if (!task) return false;
    if (canManageTask(task, user)) return true; // Admin and creator can always update status

    // Kiểm tra xem người dùng có phải người theo dõi không
    if (task.trackerIds && task.trackerIds.includes(user.user_id)) {
        return true;
    }

    // Kiểm tra xem người dùng có thuộc đơn vị được giao không
    const userOrgsQuery = await db.query('SELECT org_id FROM user_organizations WHERE user_id = $1', [user.user_id]);
    const userOrgIds = userOrgsQuery.rows.map(r => r.org_id);
    
    // Đảm bảo task.assignedOrgIds là một mảng
    const assignedOrgIds = Array.isArray(task.assignedOrgIds) ? task.assignedOrgIds : [];
    const isAssigned = assignedOrgIds.some(orgId => userOrgIds.includes(orgId));
    if (isAssigned) {
        return true;
    }

    return false;
};


const createTask = async (req, res) => {
    try {
        const creatorId = req.user.user_id;
        const newTask = await taskModel.create(req.body, creatorId);
        res.status(201).json(newTask);
    } catch (error) {
        console.error("Lỗi khi tạo công việc:", error);
        res.status(500).json({ message: "Lỗi server khi tạo công việc." });
    }
};

const getTasks = async (req, res) => {
    try {
        const tasks = await taskModel.findAll(req.user, req.query);
        res.status(200).json(tasks);
    } catch (error) {
        console.error("Lỗi khi lấy danh sách công việc:", error);
        res.status(500).json({ message: "Lỗi server khi lấy danh sách công việc." });
    }
};

const getTaskById = async (req, res) => {
    try {
        const task = await taskModel.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Không tìm thấy công việc." });
        }
        res.status(200).json(task);
    } catch (error) {
        console.error(`Lỗi khi lấy công việc ${req.params.id}:`, error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

const updateTask = async (req, res) => {
    try {
        const taskId = req.params.id;
        const task = await taskModel.findById(taskId);
        if (!canManageTask(task, req.user)) {
            return res.status(403).json({ message: "Không có quyền sửa công việc này." });
        }
        const updatedTask = await taskModel.update(taskId, req.body);
        res.status(200).json(updatedTask);
    } catch (error) {
        console.error(`Lỗi khi cập nhật công việc ${req.params.id}:`, error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

const updateTaskStatus = async (req, res) => {
    try {
        const taskId = req.params.id;
        const { status } = req.body;
        const task = await taskModel.findById(taskId);

        if (!task) {
             return res.status(404).json({ message: "Không tìm thấy công việc." });
        }
        
        const hasPermission = await canUpdateTaskStatus(task, req.user);
        if (!hasPermission) {
            return res.status(403).json({ message: "Bạn không có quyền cập nhật trạng thái công việc này." });
        }
        
        const completed_at = status === 'completed' ? new Date() : null;
        const updatedTask = await taskModel.updateStatus(taskId, status, completed_at);
        res.status(200).json(updatedTask);
    } catch (error) {
        console.error(`Lỗi khi cập nhật trạng thái công việc ${req.params.id}:`, error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

const deleteTask = async (req, res) => {
    try {
        const taskId = req.params.id;
        const task = await taskModel.findById(taskId);
        if (!canManageTask(task, req.user)) {
            return res.status(403).json({ message: "Không có quyền xóa công việc này." });
        }
        await taskModel.remove(taskId);
        res.status(200).json({ message: "Đã xóa công việc thành công." });
    } catch (error) {
        console.error(`Lỗi khi xóa công việc ${req.params.id}:`, error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

module.exports = {
    createTask,
    getTasks,
    getTaskById,
    updateTask,
    updateTaskStatus,
    deleteTask,
};

