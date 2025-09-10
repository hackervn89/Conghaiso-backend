const cron = require('node-cron');
const db = require('../config/database');
const notificationService = require('./notificationService');

/**
 * Hàm này sẽ tìm tất cả các cuộc họp diễn ra trong ngày hôm nay 
 * mà chưa được gửi thông báo nhắc nhở.
 */
const findMeetingsForDailyReminder = async () => {
    // Câu truy vấn này lấy ra meeting_id, title và một mảng các push_token của người tham dự
    const query = `
        SELECT 
            m.meeting_id, 
            m.title,
            array_agg(u.push_token) as push_tokens
        FROM meetings m
        JOIN meeting_attendees ma ON m.meeting_id = ma.meeting_id
        JOIN users u ON ma.user_id = u.user_id
        WHERE 
            m.start_time >= CURRENT_DATE 
            AND m.start_time < CURRENT_DATE + INTERVAL '1 day'
            AND m.is_reminder_sent = FALSE
            AND u.push_token IS NOT NULL
        GROUP BY m.meeting_id, m.title;
    `;
    const { rows } = await db.query(query);
    return rows;
};

/**
 * Đánh dấu các cuộc họp là đã gửi thông báo.
 * @param {number[]} meetingIds - Mảng các ID của cuộc họp.
 */
const markRemindersAsSent = async (meetingIds) => {
    if (meetingIds.length === 0) return;
    const query = 'UPDATE meetings SET is_reminder_sent = TRUE WHERE meeting_id = ANY($1::int[])';
    await db.query(query, [meetingIds]);
};

// Hàm chính thực thi tác vụ
const sendDailyReminders = async () => {
    console.log('[CronJob] Bắt đầu quét các cuộc họp cần nhắc nhở...');
    
    const meetingsToRemind = await findMeetingsForDailyReminder();

    if (meetingsToRemind.length === 0) {
        console.log('[CronJob] Không có cuộc họp nào cần nhắc nhở hôm nay.');
        return;
    }

    console.log(`[CronJob] Tìm thấy ${meetingsToRemind.length} cuộc họp. Bắt đầu gửi thông báo...`);

    for (const meeting of meetingsToRemind) {
        notificationService.sendPushNotifications(
            meeting.push_tokens,
            'Nhắc nhở Lịch họp',
            `Hôm nay bạn có cuộc họp: "${meeting.title}"`,
            { meetingId: meeting.meeting_id }
        );
    }
    
    // Sau khi gửi, đánh dấu để không gửi lại
    const remindedMeetingIds = meetingsToRemind.map(m => m.meeting_id);
    await markRemindersAsSent(remindedMeetingIds);
    console.log(`[CronJob] Đã gửi và đánh dấu xong ${remindedMeetingIds.length} cuộc họp.`);
};


// Hàm khởi tạo cron job
const initializeCronJobs = () => {
    // Cấu hình chạy vào lúc 7:00 sáng mỗi ngày
    // Cú pháp: (phút) (giờ) (ngày trong tháng) (tháng) (ngày trong tuần)
    cron.schedule('0 7 * * *', () => {
        sendDailyReminders();
    }, {
        scheduled: true,
        timezone: "Asia/Ho_Chi_Minh" // Đặt múi giờ Việt Nam
    });

    console.log('[CronJob] Đã lên lịch tác vụ nhắc nhở hàng ngày vào 7:00 sáng.');
};

module.exports = { initializeCronJobs };
