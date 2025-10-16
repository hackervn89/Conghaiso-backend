const taskModel = require('../models/taskModel');
const userModel = require('../models/userModel');
const notificationService = require('../services/notificationService');
const db = require('../config/database'); // Import db để truy vấn
const { CustomError } = require('../models/errors');
const storageService = require('../services/storageService'); // Import storageService

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
        const { newDocumentPaths, ...taskData } = req.body;

        // 1. Tạo công việc cơ bản trước để lấy task_id
        const initialTask = await taskModel.create(taskData, creatorId);

        // 2. Xử lý và di chuyển file nếu có
        const finalDocuments = [];
        if (newDocumentPaths && newDocumentPaths.length > 0) {
            for (const tempPath of newDocumentPaths) {
                if (tempPath) {
                    const moveResult = await storageService.moveFileToTaskFolder(tempPath, initialTask.task_id);
                    finalDocuments.push({
                        name: moveResult.originalName,
                        filePath: moveResult.finalPath
                    });
                }
            }
            // 3. Cập nhật CSDL với thông tin tài liệu
            await taskModel.addDocuments(initialTask.task_id, finalDocuments);
        }

        // Gửi thông báo đẩy cho người nhận việc
        if (initialTask.trackerIds && initialTask.trackerIds.length > 0) {
            const pushTokens = await userModel.findPushTokensByUserIds(initialTask.trackerIds);
            if (pushTokens.length > 0) {
                notificationService.sendPushNotifications(
                    pushTokens,
                    'Công việc mới được giao',
                    `Bạn nhận được một công việc mới: "${initialTask.title}" từ ${req.user.full_name}.`,
                    { taskId: initialTask.task_id }
                );
            }
        }

        // Sau khi xử lý file, lấy lại thông tin đầy đủ của công việc để trả về
        // Điều này đảm bảo frontend nhận được cả thông tin tài liệu mới
        const finalTask = await taskModel.findById(initialTask.task_id);
        res.status(201).json(finalTask);
    } catch (error) {
        if (error instanceof CustomError) {
            console.warn(`[Task Create] Lỗi nghiệp vụ: ${error.message}`);
            return res.status(error.statusCode).json({ message: error.message });
        }
        // Lỗi hệ thống
        console.error("Lỗi hệ thống khi tạo công việc:", error);
        res.status(500).json({ message: "Lỗi server khi tạo công việc." });
    }
};

const getTasks = async (req, res) => {
    try {        
        const tasks = await taskModel.findAll(req.user, req.query);
        res.status(200).json(tasks);
    } catch (error) {
        if (error instanceof CustomError) {
            console.warn(`[Task List] Lỗi nghiệp vụ: ${error.message}`);
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error("Lỗi hệ thống khi lấy danh sách công việc:", error);
        res.status(500).json({ message: "Lỗi server khi lấy danh sách công việc." });
    }
};

const getTaskById = async (req, res) => {
    try {
        const task = await taskModel.findById(req.params.id);
        if (!task) {
            throw new CustomError("Không tìm thấy công việc.", 404);
        }
        res.status(200).json(task);
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error(`Lỗi hệ thống khi lấy công việc ${req.params.id}:`, error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

const updateTask = async (req, res) => {
    try {
        const taskId = req.params.id;
        const task = await taskModel.findById(taskId);

        if (!task) {
            throw new CustomError("Không tìm thấy công việc để cập nhật.", 404);
        }

        if (!canManageTask(task, req.user)) {
            throw new CustomError("Không có quyền sửa công việc này.", 403);
        }

        // Tách logic xử lý file ra khỏi model và xử lý ngay tại controller
        const { newDocumentPaths, documents, ...taskData } = req.body;
        const finalDocuments = [...(documents || [])]; // Bắt đầu với các tài liệu hiện có

        // 1. Di chuyển các file mới từ thư mục tạm sang thư mục công việc
        if (newDocumentPaths && newDocumentPaths.length > 0) {
            for (const tempPath of newDocumentPaths) {
                if (tempPath) {
                    const moveResult = await storageService.moveFileToTaskFolder(tempPath, taskId);
                    finalDocuments.push({
                        filePath: moveResult.finalPath,
                        name: moveResult.originalName
                    });
                }
            }
        }

        // 2. Chuẩn bị payload cuối cùng cho model
        const finalPayload = {
            ...taskData, // title, description, assignedOrgIds, trackerIds, etc.
            documents: finalDocuments, // Mảng các đối tượng file đã có đường dẫn cuối cùng
        };

        const updatedTask = await taskModel.update(taskId, finalPayload);
        res.status(200).json(updatedTask);
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error(`[Task Update] Lỗi hệ thống khi cập nhật công việc ${req.params.id}:`, error);
        res.status(500).json({ message: "Có lỗi xảy ra, không thể lưu công việc." });
    }
};

const updateTaskStatus = async (req, res) => {
    try {
        const taskId = req.params.id;
        const { status } = req.body;
        const task = await taskModel.findById(taskId);

        if (!task) {
             throw new CustomError("Không tìm thấy công việc.", 404);
        }
        
        const hasPermission = await canUpdateTaskStatus(task, req.user);
        if (!hasPermission) {
            throw new CustomError("Bạn không có quyền cập nhật trạng thái công việc này.", 403);
        }
        
        const completed_at = status === 'completed' ? new Date() : null;
        const updatedTask = await taskModel.updateStatus(taskId, status, completed_at);
        res.status(200).json(updatedTask);
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error(`Lỗi hệ thống khi cập nhật trạng thái công việc ${req.params.id}:`, error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

const deleteTask = async (req, res) => {
    try {
        const taskId = req.params.id;
        const task = await taskModel.findById(taskId);
        if (!task) {
            throw new CustomError("Không tìm thấy công việc để xóa.", 404);
        }
        if (!canManageTask(task, req.user)) {
            throw new CustomError("Không có quyền xóa công việc này.", 403);
        }
        await taskModel.remove(taskId);
        res.status(200).json({ message: "Đã xóa công việc thành công." });
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error(`Lỗi hệ thống khi xóa công việc ${req.params.id}:`, error);
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
