const dashboardModel = require('../models/dashboardModel');

const getDashboardStats = async (req, res) => {
    try {
        // req.user được middleware 'protect' gắn vào
        const stats = await dashboardModel.getStats(req.user);
        res.status(200).json(stats);
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu thống kê cho dashboard:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

module.exports = { getDashboardStats };