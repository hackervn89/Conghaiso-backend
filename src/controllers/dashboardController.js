const dashboardModel = require('../models/dashboardModel');
const taskModel = require('../models/taskModel'); // <-- IMPORT MỚI

const getDashboardStats = async (req, res) => {
    try {
        const user = req.user;
        // Lấy thống kê cũ (cuộc họp, người dùng)
        const stats = await dashboardModel.getStats(user);

        // [MỚI] Lấy thêm thống kê công việc (việc trễ hạn)
        const taskSummary = await taskModel.getTasksSummary(user.user_id);
        
        // Gộp hai kết quả lại và trả về
        const combinedStats = { ...stats, ...taskSummary };
        
        res.status(200).json(combinedStats);
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu thống kê cho dashboard:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

module.exports = { getDashboardStats };