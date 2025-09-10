const db = require('../config/database');

/**
 * Lấy các số liệu thống kê cho Dashboard.
 * @param {object} user - Đối tượng người dùng đã được xác thực.
 * @returns {Promise<object>} - Một đối tượng chứa các số liệu thống kê.
 */
const getStats = async (user) => {
    const stats = {};

    // 1. Đếm số cuộc họp trong tháng này (theo quyền)
    let meetingsThisMonthQuery;
    if (user.role === 'Admin') {
        meetingsThisMonthQuery = `
            SELECT COUNT(*) FROM meetings 
            WHERE date_trunc('month', start_time) = date_trunc('month', CURRENT_DATE);
        `;
        const { rows } = await db.query(meetingsThisMonthQuery);
        stats.meetingsThisMonth = parseInt(rows[0].count, 10);
    } else if (user.role === 'Secretary') {
        meetingsThisMonthQuery = `
            SELECT COUNT(*) FROM meetings 
            WHERE creator_id = $1 AND date_trunc('month', start_time) = date_trunc('month', CURRENT_DATE);
        `;
        const { rows } = await db.query(meetingsThisMonthQuery, [user.user_id]);
        stats.meetingsThisMonth = parseInt(rows[0].count, 10);
    }

    // 2. Đếm tổng số người dùng (chỉ dành cho Admin)
    if (user.role === 'Admin') {
        const totalUsersQuery = 'SELECT COUNT(*) FROM users;';
        const { rows } = await db.query(totalUsersQuery);
        stats.totalUsers = parseInt(rows[0].count, 10);
    }

    // Các thống kê khác có thể được thêm vào đây trong tương lai
    
    return stats;
};

module.exports = { getStats };
