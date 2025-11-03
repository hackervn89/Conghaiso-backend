const chatModel = require('../models/chatModel');
const { CustomError } = require('../models/errors');

/**
 * Lấy danh sách tất cả các phiên trò chuyện của người dùng hiện tại.
 */
const listSessions = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const sessions = await chatModel.getSessionsByUserId(userId);
        res.status(200).json(sessions);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách phiên chat:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách phiên chat.' });
    }
};

/**
 * Lấy tất cả tin nhắn của một phiên trò chuyện cụ thể.
 */
const getSessionMessages = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const history = await chatModel.getHistoryBySessionId(sessionId, userId);
        res.status(200).json(history);
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error('Lỗi khi lấy tin nhắn của phiên chat:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy tin nhắn.' });
    }
};

/**
 * Xóa một phiên trò chuyện.
 */
const deleteSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        await chatModel.deleteSession(sessionId, userId);
        res.status(200).json({ message: 'Đã xóa phiên trò chuyện thành công.' });
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error('Lỗi khi xóa phiên chat:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa phiên chat.' });
    }
};

module.exports = { listSessions, getSessionMessages, deleteSession };