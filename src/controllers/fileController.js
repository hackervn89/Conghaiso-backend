const path = require('path');
const db = require('../config/database');
const meetingModel = require('../models/meetingModel');
const taskModel = require('../models/taskModel');

const STORAGE_BASE_PATH = process.env.STORAGE_PATH;

const serveFile = async (req, res) => {
    const { path: relativeFilePath } = req.query;
    const user = req.user;

    if (!relativeFilePath) {
        return res.status(400).json({ message: 'Yêu cầu đường dẫn tệp.' });
    }
    if (!STORAGE_BASE_PATH) {
        console.error("[SECURITY] STORAGE_PATH chưa được thiết lập. Không thể phục vụ tệp.");
        return res.status(500).json({ message: 'Lỗi cấu hình server.' });
    }

    try {
        // --- Bước 1: Kiểm tra bảo mật - Tìm tệp trong CSDL để xác định quyền sở hữu ---
        let entityType = null;
        let entityId = null;

        // Kiểm tra xem có phải là tài liệu cuộc họp không
        let { rows: docs } = await db.query(
            `SELECT a.meeting_id FROM documents d JOIN agendas a ON d.agenda_id = a.agenda_id WHERE d.file_path = $1`,
            [relativeFilePath]
        );

        if (docs.length > 0) {
            entityType = 'meeting';
            entityId = docs[0].meeting_id;
        } else {
            // Nếu không, kiểm tra xem có phải là tài liệu công việc không
            ({ rows: docs } = await db.query(
                `SELECT task_id FROM task_documents WHERE file_path = $1`,
                [relativeFilePath]
            ));
            if (docs.length > 0) {
                entityType = 'task';
                entityId = docs[0].task_id;
            }
        }

        if (!entityType) {
            return res.status(404).json({ message: 'Không tìm thấy tệp hoặc đường dẫn không hợp lệ.' });
        }

        // --- Bước 2: Kiểm tra quyền - Xác minh người dùng có thể truy cập thực thể cha không ---
        let hasPermission = false;
        if (entityType === 'meeting') {
            const meeting = await meetingModel.findById(entityId, user);
            if (meeting) {
                hasPermission = true;
            }
        } else if (entityType === 'task') {
            const task = await taskModel.findById(entityId);
            if (task) {
                const isCreator = task.creator_id === user.user_id;
                const isTracker = task.trackerIds && task.trackerIds.includes(user.user_id);
                if (user.role === 'Admin' || isCreator || isTracker) {
                    hasPermission = true;
                }
            }
        }

        if (!hasPermission) {
            return res.status(403).json({ message: 'Bạn không có quyền truy cập tệp này.' });
        }

        // --- Bước 3: Phục vụ tệp ---
        // Làm sạch đường dẫn để chống tấn công duyệt thư mục
        const safeRelativePath = path.normalize(relativeFilePath).replace(/^(\\..[\\/])|([\\/]\\..)/g, '');
        const absoluteFilePath = path.join(STORAGE_BASE_PATH, safeRelativePath);

        // Kiểm tra bảo mật cuối cùng
        if (!absoluteFilePath.startsWith(path.resolve(STORAGE_BASE_PATH))) {
            console.error(`[SECURITY] Cố gắng truy cập tệp bên ngoài đường dẫn lưu trữ: ${relativeFilePath}`);
            return res.status(400).json({ message: 'Đường dẫn tệp không hợp lệ.' });
        }

        res.sendFile(absoluteFilePath, (err) => {
            if (err) {
                if (err.code === "ENOENT") {
                    console.error(`[File Serving] Tệp không tồn tại trên đĩa nhưng có trong CSDL: ${absoluteFilePath}`);
                    return res.status(404).send('Không tìm thấy tệp trên server.');
                }
                console.error(`[File Serving] Lỗi khi gửi tệp: ${absoluteFilePath}`, err);
                res.status(500).send('Lỗi khi phục vụ tệp.');
            }
        });

    } catch (error) {
        console.error('Lỗi trong controller serveFile:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

module.exports = { serveFile };
