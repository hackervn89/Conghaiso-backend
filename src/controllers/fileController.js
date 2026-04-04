const path = require('path');
const db = require('../config/database');
const meetingModel = require('../models/meetingModel');
const taskModel = require('../models/taskModel');
const draftModel = require('../models/draftModel'); // Thêm draftModel

const STORAGE_BASE_PATH = process.env.STORAGE_PATH;

/**
 * Chuẩn hóa đường dẫn tệp tin để khớp với CSDL và đảm bảo an toàn.
 * @param {string} p - Đường dẫn thô từ request.
 * @returns {string} - Đường dẫn đã chuẩn hóa.
 */
const normalizePath = (p) => {
    if (!p) return '';
    let clean = p.replace(/\\/g, '/'); // Chuẩn hóa gạch chéo
    
    // Nếu là một URL tuyệt đối (ví dụ từ log: http://.../uploads/tasks/...)
    try {
        if (clean.startsWith('http')) {
            const url = new URL(clean);
            clean = url.pathname; // Lấy phần /uploads/tasks/...
        }
    } catch (e) {
        // Nếu không phải URL hợp lệ, giữ nguyên để xử lý tiếp
    }

    return clean.replace(/^\/+/, '')          // Xóa gạch chéo đầu
                .replace(/^uploads\//, '');   // Xóa tiền tố uploads/
};

const serveFile = async (req, res) => {
    const rawPath = req.query.path;
    const user = req.user;

    if (!rawPath) {
        return res.status(400).json({ message: 'Yêu cầu đường dẫn tệp.' });
    }
    
    const relativeFilePath = normalizePath(rawPath);
    console.log(`[File Serving] Đang yêu cầu tệp: "${rawPath}" -> Chuẩn hóa: "${relativeFilePath}" (User ID: ${user.user_id})`);

    if (!STORAGE_BASE_PATH) {
        console.error("[SECURITY] STORAGE_PATH chưa được thiết lập.");
        return res.status(500).json({ message: 'Lỗi cấu hình server.' });
    }

    try {
        // --- Bước 0: Hỗ trợ xem tệp trong thư mục tạm (Preview) ---
        if (relativeFilePath.startsWith('temp/')) {
            console.log(`[File Serving] Cho phép xem tệp tạm: ${relativeFilePath}`);
            return servePhysicalFile(res, relativeFilePath);
        }

        // --- Bước 1: Tìm tệp trong CSDL ---
        let entityType = null;
        let entityId = null;

        // 1.1 Kiểm tra Cuộc họp
        let { rows: docs } = await db.query(
            `SELECT a.meeting_id FROM documents d JOIN agendas a ON d.agenda_id = a.agenda_id WHERE d.file_path = $1`,
            [relativeFilePath]
        );

        if (docs.length > 0) {
            entityType = 'meeting';
            entityId = docs[0].meeting_id;
        } else {
            // 1.2 Kiểm tra Công việc
            ({ rows: docs } = await db.query(
                `SELECT task_id FROM task_documents WHERE file_path = $1`,
                [relativeFilePath]
            ));
            if (docs.length > 0) {
                entityType = 'task';
                entityId = docs[0].task_id;
            } else {
                // 1.3 Kiểm tra Dự thảo
                ({ rows: docs } = await db.query(
                    `SELECT draft_id FROM draft_attachments WHERE file_path = $1`,
                    [relativeFilePath]
                ));
                if (docs.length > 0) {
                    entityType = 'draft';
                    entityId = docs[0].draft_id;
                }
            }
        }

        if (!entityType) {
            console.warn(`[File Serving] KHÔNG TÌM THẤY tệp "${relativeFilePath}" trong CSDL.`);
            return res.status(404).json({ message: 'Không tìm thấy tệp hoặc đường dẫn không hợp lệ.' });
        }

        console.log(`[File Serving] Tệp thuộc thực thể: ${entityType} (ID: ${entityId})`);

        // --- Bước 2: Kiểm tra quyền ---
        let hasPermission = false;
        if (entityType === 'meeting') {
            const meeting = await meetingModel.findById(entityId, user);
            if (meeting) hasPermission = true;
        } else if (entityType === 'task') {
            hasPermission = await taskModel.checkTaskAccess(entityId, user);
        } else if (entityType === 'draft') {
            const draft = await draftModel.findById(entityId, user.user_id);
            if (draft) hasPermission = true;
        }

        if (!hasPermission) {
            console.error(`[File Serving] TỪ CHỐI TRUY CẬP: User ${user.user_id} không có quyền xem ${entityType} ${entityId}`);
            return res.status(403).json({ message: 'Bạn không có quyền truy cập tệp này.' });
        }

        // --- Bước 3: Phục vụ tệp vật lý ---
        return servePhysicalFile(res, relativeFilePath);

    } catch (error) {
        console.error('Lỗi trong controller serveFile:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

/**
 * Hàm hỗ trợ gửi file vật lý lên trình duyệt
 */
const servePhysicalFile = (res, relativePath) => {
    const safePath = path.normalize(relativePath).replace(/^(\\..[\\/])|([\\/]\\..)/g, '');
    const absoluteFilePath = path.join(STORAGE_BASE_PATH, safePath);

    if (!absoluteFilePath.startsWith(path.resolve(STORAGE_BASE_PATH))) {
        return res.status(400).json({ message: 'Đường dẫn tệp không hợp lệ.' });
    }

    res.sendFile(absoluteFilePath, (err) => {
        if (err) {
            if (err.code === "ENOENT") {
                console.error(`[File Serving] Tệp không tồn tại trên đĩa: ${absoluteFilePath}`);
                return res.status(404).send('Không tìm thấy tệp trên server.');
            }
            res.status(500).send('Lỗi khi phục vụ tệp.');
        }
    });
};

module.exports = { serveFile };
