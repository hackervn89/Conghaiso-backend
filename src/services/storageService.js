const fs = require('fs/promises');
const path = require('path');

// Lấy đường dẫn lưu trữ cơ sở từ biến môi trường.
// Đây phải là một đường dẫn tuyệt đối, ví dụ: 'd:/Conghaiso/uploads'
const STORAGE_BASE_PATH = process.env.STORAGE_PATH;

if (!STORAGE_BASE_PATH) {
    console.error("[FATAL] Biến môi trường STORAGE_PATH chưa được thiết lập. Việc tải lên tệp sẽ thất bại.");
}

/**
 * Lưu một file buffer vào một thư mục có cấu trúc cho một thực thể cụ thể (ví dụ: cuộc họp).
 * Đường dẫn cuối cùng sẽ có dạng: /<năm>/<tháng>/<entityId>/<tên_file>
 * @param {object} file - Đối tượng tệp từ multer (chứa buffer, originalname).
 * @param {string|number} entityId - ID của thực thể (ví dụ: meeting_id) mà tệp thuộc về.
 * @returns {Promise<string>} - Đường dẫn tương đối đến tệp đã lưu, sử dụng dấu gạch chéo xuôi.
 */
const saveFileToEntityFolder = async (file, entityId) => {
    if (!STORAGE_BASE_PATH) {
        throw new Error("STORAGE_PATH chưa được cấu hình.");
    }

    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');

    // Làm sạch tên tệp để ngăn chặn các cuộc tấn công duyệt thư mục (directory traversal).
    const sanitizedFilename = path.basename(file.originalname);

    const relativeDir = path.join(year, month, entityId.toString());
    const absoluteDir = path.join(STORAGE_BASE_PATH, relativeDir);

    // Tạo thư mục nếu nó không tồn tại
    await fs.mkdir(absoluteDir, { recursive: true });

    const relativeFilePath = path.join(relativeDir, sanitizedFilename);
    const absoluteFilePath = path.join(absoluteDir, sanitizedFilename);

    await fs.writeFile(absoluteFilePath, file.buffer);

    // Trả về đường dẫn tương đối sử dụng dấu gạch chéo xuôi để nhất quán trong CSDL và URL
    return relativeFilePath.replace(/\\/g, '/');
};

/**
 * Xóa một tệp dựa trên đường dẫn tương đối của nó trong thư mục lưu trữ.
 * @param {string} relativeFilePath - Đường dẫn tương đối của tệp cần xóa (ví dụ: '2025/10/90/document.pdf').
 */
const deleteFile = async (relativeFilePath) => {
    if (!relativeFilePath || !STORAGE_BASE_PATH) return;
    
    try {
        // Ngăn chặn các cuộc tấn công duyệt thư mục
        const safeRelativePath = path.normalize(relativeFilePath).replace(/^(\\..[\\/])|([\\/\\.]\.)/g, '');
        const absoluteFilePath = path.join(STORAGE_BASE_PATH, safeRelativePath);

        // Kiểm tra cuối cùng để đảm bảo chúng ta vẫn ở trong đường dẫn lưu trữ
        if (!absoluteFilePath.startsWith(STORAGE_BASE_PATH)) {
             console.error(`[SECURITY] Cố gắng xóa tệp bên ngoài đường dẫn lưu trữ: ${relativeFilePath}`);
             return;
        }

        await fs.unlink(absoluteFilePath);
        console.log(`[Storage] Đã xóa tệp: ${absoluteFilePath}`);
    } catch (error) {
        // Nếu tệp không tồn tại, chúng ta không cần ném lỗi.
        if (error.code !== 'ENOENT') {
            console.error(`[Storage] Lỗi khi xóa tệp ${relativeFilePath}:`, error);
        }
    }
};

module.exports = {
    saveFileToEntityFolder,
    deleteFile,
    STORAGE_BASE_PATH,
};
