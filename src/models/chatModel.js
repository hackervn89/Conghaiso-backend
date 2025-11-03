const db = require('../config/database');
const { CustomError } = require('./errors');

/**
 * Tạo một phiên trò chuyện mới.
 * @param {number} userId - ID của người dùng tạo phiên.
 * @param {string} firstPrompt - Câu hỏi đầu tiên của người dùng để tạo tiêu đề.
 * @returns {Promise<string>} - ID của phiên mới được tạo.
 */
const createSession = async (userId, firstPrompt) => {
    // Tự động tạo tiêu đề tóm tắt từ câu hỏi đầu tiên.
    const title = firstPrompt.substring(0, 80) + (firstPrompt.length > 80 ? '...' : '');
    const { rows } = await db.query(
        'INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING session_id',
        [userId, title]
    );
    return rows[0].session_id;
};

/**
 * Thêm một tin nhắn mới vào một phiên trò chuyện.
 * Sử dụng transaction để đảm bảo tính toàn vẹn dữ liệu.
 * @param {string} sessionId - ID của phiên.
 * @param {'user' | 'model'} role - Vai trò của người gửi.
 * @param {string} content - Nội dung tin nhắn.
 */
const addMessage = async (sessionId, role, content) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        // Thêm tin nhắn mới
        await client.query(
            'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
            [sessionId, role, content]
        );
        // Cập nhật thời gian của phiên để đưa lên đầu danh sách
        await client.query(
            'UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = $1',
            [sessionId]
        );
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Lỗi khi thêm tin nhắn vào CSDL:', e);
        throw new Error('Không thể lưu tin nhắn.');
    } finally {
        client.release();
    }
};

/**
 * Lấy lịch sử tin nhắn của một phiên, đồng thời kiểm tra quyền sở hữu.
 * @param {string} sessionId - ID của phiên.
 * @param {number} userId - ID của người dùng yêu cầu.
 * @returns {Promise<Array<object>>} - Mảng các tin nhắn theo định dạng của Gemini API.
 */
const getHistoryBySessionId = async (sessionId, userId) => {
    const { rows } = await db.query(
        `SELECT m.role, m.content AS text 
         FROM chat_messages m
         JOIN chat_sessions s ON m.session_id = s.session_id
         WHERE m.session_id = $1 AND s.user_id = $2 
         ORDER BY m.created_at ASC`,
        [sessionId, userId]
    );
    // Nếu không có dòng nào trả về, có thể là session không tồn tại hoặc không thuộc sở hữu của user
    if (rows.length === 0) {
        const sessionCheck = await db.query('SELECT 1 FROM chat_sessions WHERE session_id = $1', [sessionId]);
        if (sessionCheck.rows.length === 0) {
            throw new CustomError('Không tìm thấy phiên trò chuyện.', 404);
        } else {
            throw new CustomError('Bạn không có quyền truy cập phiên trò chuyện này.', 403);
        }
    }
    return rows.map(row => ({ role: row.role, parts: [{ text: row.text }] }));
};

/**
 * Lấy tất cả các phiên trò chuyện của một người dùng.
 * @param {number} userId - ID của người dùng.
 * @returns {Promise<Array<object>>} - Mảng các phiên trò chuyện.
 */
const getSessionsByUserId = async (userId) => {
    const { rows } = await db.query(
        'SELECT session_id, title, created_at, updated_at FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC',
        [userId]
    );
    return rows;
};

/**
 * Xóa một phiên trò chuyện và tất cả tin nhắn liên quan (nhờ ON DELETE CASCADE).
 * @param {string} sessionId - ID của phiên cần xóa.
 * @param {number} userId - ID của người dùng để kiểm tra quyền.
 */
const deleteSession = async (sessionId, userId) => {
    const { rowCount } = await db.query(
        'DELETE FROM chat_sessions WHERE session_id = $1 AND user_id = $2',
        [sessionId, userId]
    );
    if (rowCount === 0) {
        throw new CustomError('Không tìm thấy phiên trò chuyện hoặc bạn không có quyền xóa.', 404);
    }
};

module.exports = {
    createSession,
    addMessage,
    getHistoryBySessionId,
    getSessionsByUserId,
    deleteSession,
};