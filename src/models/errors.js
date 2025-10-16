/**
 * Lớp lỗi tùy chỉnh để xử lý các lỗi nghiệp vụ với mã trạng thái HTTP cụ thể.
 */
class CustomError extends Error {
    /**
     * @param {string} message - Thông báo lỗi cho client.
     * @param {number} statusCode - Mã trạng thái HTTP (ví dụ: 400, 403, 404, 409).
     */
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = this.constructor.name; // Đặt tên cho lỗi
    }
}

module.exports = { CustomError };