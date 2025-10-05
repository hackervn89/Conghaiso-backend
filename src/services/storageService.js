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
 * Di chuyển một tệp từ đường dẫn tạm thời đến một đường dẫn đích cuối cùng.
 * Đây là hàm nội bộ, được sử dụng bởi các hàm di chuyển file khác.
 * @param {string} tempRelativePath - Đường dẫn tương đối của tệp trong thư mục tạm.
 * @param {string} finalRelativePath - Đường dẫn tương đối cuối cùng của tệp.
 * @returns {Promise<string>} - Đường dẫn tương đối cuối cùng của tệp.
 */
const moveFileFromTemp = async (tempRelativePath, finalRelativePath) => {
    if (!tempRelativePath || !tempRelativePath.startsWith(TEMP_DIR)) {
        throw new Error("Đường dẫn tệp tạm thời không hợp lệ.");
    }

    const sourceAbsolutePath = getAbsolutePath(tempRelativePath);
    const destAbsolutePath = getAbsolutePath(finalRelativePath);

    try {
        await fs.mkdir(path.dirname(destAbsolutePath), { recursive: true });
        await fs.rename(sourceAbsolutePath, destAbsolutePath);
        return finalRelativePath;
    } catch (error) {
        console.error(`Lỗi khi di chuyển tệp từ ${tempRelativePath} đến ${finalRelativePath}:`, error);
        throw error;
    }
};

/**
 * Di chuyển một tệp từ vị trí tạm thời đến thư mục cuối cùng của nó.
 * @param {string} tempRelativePath - Đường dẫn tương đối của tệp trong thư mục tạm.
 * @param {string|number} meetingId - ID của cuộc họp.
 * @param {Date|string} meetingDate - Ngày diễn ra cuộc họp.
 * @returns {Promise<string>} - Đường dẫn tương đối cuối cùng của tệp.
 */
const moveFileToMeetingFolder = async (tempRelativePath, meetingId, meetingDate) => {
    // Chuyển đổi sang múi giờ Việt Nam để đảm bảo ngày tháng chính xác
    const date = new Date(meetingDate); // meetingDate là chuỗi ISO từ DB
    const options = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
    const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(date);
    const { day, month, year } = Object.fromEntries(parts.map(p => [p.type, p.value]));

    const sanitizedFilename = path.basename(tempRelativePath).split('-').slice(2).join('-');

    // Cấu trúc thư mục mới: meetings/mm-yyyy/meeting_id/tên_file
    const dateFolder = `${month}-${year}`;
    const finalRelativePath = path.join('meetings', dateFolder, String(meetingId), sanitizedFilename).replace(/\\/g, '/');
    
    return await moveFileFromTemp(tempRelativePath, finalRelativePath);
};

/**
 * Lưu một tệp đính kèm cho dự thảo vào thư mục cuối cùng của nó.
 * Cấu trúc thư mục: drafts/YYYY/MM/draftId/filename
 * @param {object} file - Đối tượng tệp từ multer (đã được decode tên).
 * @param {number} draftId - ID của dự thảo.
 * @returns {Promise<string>} - Đường dẫn tương đối cuối cùng của tệp.
 */
const saveDraftAttachment = async (file, draftId) => {
    if (!STORAGE_BASE_PATH) {
        throw new Error("STORAGE_PATH chưa được cấu hình.");
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    const dateFolder = `${month}-${year}`; // Tạo thư mục theo định dạng MM-YYYY
    const sanitizedFilename = path.basename(file.originalname);

    // Cấu trúc thư mục mới: drafts/mm-yyyy/draft_id/tên_file_gốc
    const newRelativeDir = path.join('drafts', dateFolder, String(draftId));
    const finalRelativePath = path.join(newRelativeDir, sanitizedFilename).replace(/\\/g, '/');

    const destAbsolutePath = getAbsolutePath(finalRelativePath);

    await fs.mkdir(path.dirname(destAbsolutePath), { recursive: true });
    await fs.writeFile(destAbsolutePath, file.buffer);
    return finalRelativePath;
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

        // Lấy đường dẫn tuyệt đối, đã được chuẩn hóa của thư mục gốc và tệp cần xóa.
        const resolvedBasePath = path.resolve(STORAGE_BASE_PATH);
        const resolvedFilePath = path.resolve(absoluteFilePath);

        if (!resolvedFilePath.startsWith(resolvedBasePath)) {
             console.error(`[SECURITY] Cố gắng xóa tệp bên ngoài đường dẫn lưu trữ: ${resolvedFilePath}`);
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

/**
 * Xóa một thư mục (và các thư mục cha rỗng của nó).
 * @param {string} relativeDirPath - Đường dẫn tương đối của thư mục cần xóa.
 */
const deleteDirectory = async (relativeDirPath) => {
    if (!relativeDirPath || !STORAGE_BASE_PATH) return;

    try {
        const absoluteDirPath = getAbsolutePath(relativeDirPath);

        // Kiểm tra bảo mật để đảm bảo không xóa thư mục ngoài phạm vi cho phép
        const resolvedBasePath = path.resolve(STORAGE_BASE_PATH);
        const resolvedDirPath = path.resolve(absoluteDirPath);

        if (!resolvedDirPath.startsWith(resolvedBasePath) || resolvedDirPath === resolvedBasePath) {
            console.error(`[SECURITY] Cố gắng xóa thư mục bên ngoài hoặc thư mục gốc: ${resolvedDirPath}`);
            return;
        }

        // Xóa thư mục và tất cả nội dung bên trong nó (recursive: true)
        // và thử lại nếu gặp lỗi (retry) trên Windows
        await fs.rm(absoluteDirPath, { recursive: true, force: true });
        console.log(`[Storage] Đã xóa thư mục: ${absoluteDirPath}`);
    } catch (error) {
        console.error(`[Storage] Lỗi khi xóa thư mục ${relativeDirPath}:`, error);
    }
};

module.exports = {
    saveFileToTempFolder,
    moveFileToMeetingFolder,
    // Hàm moveFileFromTemp là hàm nội bộ, không cần export
    saveDraftAttachment,
    deleteFile,
    deleteDirectory,
    STORAGE_BASE_PATH,
};