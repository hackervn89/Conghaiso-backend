const cron = require('node-cron');
const db = require('../config/database');
const notificationService = require('./notificationService');
const draftModel = require('../models/draftModel'); // Thêm model dự thảo

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

// === TÁC VỤ MỚI: CẬP NHẬT DỰ THẢO QUÁ HẠN ===
const processOverdueDrafts = async () => {
    console.log('[CronJob] Bắt đầu quét các dự thảo quá hạn...');
    try {
        const overdueDrafts = await draftModel.updateOverdueDrafts();

        if (overdueDrafts.length === 0) {
            console.log('[CronJob] Không có dự thảo nào bị quá hạn.');
            return;
        }

        console.log(`[CronJob] Tìm thấy ${overdueDrafts.length} dự thảo quá hạn. Bắt đầu gửi thông báo...`);

        // (Nâng cao) Gửi thông báo cho người tạo
        for (const draft of overdueDrafts) {
            const creatorId = draft.creator_id;
            // Giả sử userModel có hàm findPushTokensByUserIds
            const userModel = require('../models/userModel');
            const pushTokens = await userModel.findPushTokensByUserIds([creatorId]);
            if (pushTokens.length > 0) {
                notificationService.sendPushNotifications(
                    pushTokens,
                    'Dự thảo đã quá hạn góp ý',
                    `Luồng góp ý cho dự thảo "${draft.title}" đã kết thúc.`,
                    { type: 'draft_overdue', draftId: draft.id }
                );
            }
        }
        console.log(`[CronJob] Đã xử lý và thông báo cho ${overdueDrafts.length} dự thảo quá hạn.`);
    } catch (error) {
        console.error('[CronJob] Lỗi khi xử lý dự thảo quá hạn:', error);
    }
};

// Hàm khởi tạo cron job
const initializeCronJobs = () => {
    // Cấu hình chạy vào lúc 7:00 sáng mỗi ngày
    cron.schedule('0 7 * * *', sendDailyReminders, {
        scheduled: true,
        timezone: "Asia/Ho_Chi_Minh" // Đặt múi giờ Việt Nam
    });
    console.log('[CronJob] Đã lên lịch tác vụ nhắc nhở hàng ngày vào 7:00 sáng.');

    // Cấu hình chạy vào lúc 00:01 mỗi ngày để kiểm tra dự thảo quá hạn
    cron.schedule('1 0 * * *', processOverdueDrafts, {
        scheduled: true,
        timezone: "Asia/Ho_Chi_Minh"
    });
    console.log('[CronJob] Đã lên lịch tác vụ kiểm tra dự thảo quá hạn vào 00:01 mỗi ngày.');
};

module.exports = { initializeCronJobs };
