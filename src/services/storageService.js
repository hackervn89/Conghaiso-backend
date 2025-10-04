const fs = require('fs/promises');
const path = require('path');

// Lấy đường dẫn lưu trữ cơ sở từ biến môi trường.
// Đây phải là một đường dẫn tuyệt đối, ví dụ: 'd:/Conghaiso/uploads'
const STORAGE_BASE_PATH = process.env.STORAGE_PATH;
const TEMP_DIR = 'temp'; // Thư mục tạm

if (!STORAGE_BASE_PATH) {
    console.error("[FATAL] Biến môi trường STORAGE_PATH chưa được thiết lập. Việc tải lên tệp sẽ thất bại.");
}

/**
 * Chuyển đổi đường dẫn tương đối trong thư mục lưu trữ thành đường dẫn tuyệt đối.
 * @param {string} relativePath - Đường dẫn tương đối (ví dụ: 'temp/file.txt').
 * @returns {string} - Đường dẫn tuyệt đối.
 */
const getAbsolutePath = (relativePath) => path.join(STORAGE_BASE_PATH, relativePath);

/**
 * Lưu một tệp vào thư mục tạm thời.
 * @param {object} file - Đối tượng tệp từ multer.
 * @returns {Promise<string>} - Đường dẫn tương đối đến tệp tạm thời.
 */
const saveFileToTempFolder = async (file) => {
    if (!STORAGE_BASE_PATH) {
        throw new Error("STORAGE_PATH chưa được cấu hình.");
    }
    const tempDirPath = getAbsolutePath(TEMP_DIR);
    await fs.mkdir(tempDirPath, { recursive: true });

    // Tạo tên tệp duy nhất để tránh ghi đè
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const tempFilename = `${uniqueSuffix}-${path.basename(file.originalname)}`;
    
    const relativePath = path.join(TEMP_DIR, tempFilename).replace(/\\/g, '/');
    const absolutePath = getAbsolutePath(relativePath);

    await fs.writeFile(absolutePath, file.buffer);
    return relativePath; // Trả về đường dẫn tương đối, ví dụ: 'temp/167...-document.pdf'
};

/**
 * Di chuyển một tệp từ vị trí tạm thời đến thư mục cuối cùng của nó.
 * @param {string} tempRelativePath - Đường dẫn tương đối của tệp trong thư mục tạm.
 * @param {string|number} meetingId - ID của cuộc họp.
 * @param {Date|string} meetingDate - Ngày diễn ra cuộc họp.
 * @returns {Promise<string>} - Đường dẫn tương đối cuối cùng của tệp.
 */
const moveFileToMeetingFolder = async (tempRelativePath, meetingId, meetingDate) => {
    if (!tempRelativePath || !tempRelativePath.startsWith(TEMP_DIR)) {
        throw new Error("Đường dẫn tệp tạm thời không hợp lệ.");
    }

    // Chuyển đổi sang múi giờ Việt Nam để đảm bảo ngày tháng chính xác
    const date = new Date(meetingDate); // meetingDate là chuỗi ISO từ DB
    const options = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
    const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(date);
    const { day, month, year } = Object.fromEntries(parts.map(p => [p.type, p.value]));

    // Lấy lại tên tệp gốc từ đường dẫn tạm thời
    const originalFilename = path.basename(tempRelativePath).split('-').slice(2).join('-');
    const sanitizedFilename = path.basename(originalFilename);

    // Cấu trúc thư mục mới theo yêu cầu: meetings/dd-mm-yyyy-meeting_id/tên_file
    const folderName = `${day}-${month}-${year}-${meetingId}`;
    const newRelativeDir = path.join('meetings', folderName);
    const finalRelativePath = path.join(newRelativeDir, sanitizedFilename).replace(/\\/g, '/');

    const sourceAbsolutePath = getAbsolutePath(tempRelativePath);
    const destAbsolutePath = getAbsolutePath(finalRelativePath);

    try {
        await fs.mkdir(path.dirname(destAbsolutePath), { recursive: true });
        await fs.rename(sourceAbsolutePath, destAbsolutePath);
        return finalRelativePath;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`Tệp tạm thời không tìm thấy để di chuyển: ${tempRelativePath}. Có thể nó đã được xử lý.`);
            // Trả về đường dẫn cuối cùng như thể nó đã thành công, để không làm gián đoạn luồng
            return finalRelativePath;
        }
        console.error(`Lỗi khi di chuyển tệp từ ${tempRelativePath}:`, error);
        throw error;
    }
};


/**
 * Xóa một tệp dựa trên đường dẫn tương đối của nó trong thư mục lưu trữ.
 * @param {string} relativeFilePath - Đường dẫn tương đối của tệp cần xóa (ví dụ: 'meetings/2025/10/04_90/document.pdf').
 */
const deleteFile = async (relativeFilePath) => {
    if (!relativeFilePath || !STORAGE_BASE_PATH) return;
    
    try {
        const safeRelativePath = path.normalize(relativeFilePath).replace(/^(\.\.[\/\\])|([\/\\].\.)/g, '');
        const absoluteFilePath = getAbsolutePath(safeRelativePath);

        if (!absoluteFilePath.startsWith(STORAGE_BASE_PATH)) {
             console.error(`[SECURITY] Cố gắng xóa tệp bên ngoài đường dẫn lưu trữ: ${relativeFilePath}`);
             return;
        }

        await fs.unlink(absoluteFilePath);
        console.log(`[Storage] Đã xóa tệp: ${absoluteFilePath}`);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`[Storage] Lỗi khi xóa tệp ${relativeFilePath}:`, error);
        }
    }
};

module.exports = {
    saveFileToTempFolder,
    moveFileToMeetingFolder,
    deleteFile,
    STORAGE_BASE_PATH,
};