const { Expo } = require('expo-server-sdk');
const path = require('path');
const userModel = require('../models/userModel'); // Thêm userModel
const fs = require('fs');

// Đường dẫn đến file "chìa khóa" Firebase V1
const SERVICE_ACCOUNT_KEY_PATH = path.join(process.cwd(), process.env.GOOGLE_FCM_CREDENTIALS_PATH);

let expo;
// Kiểm tra xem file credentials có tồn tại không trước khi khởi tạo
if (fs.existsSync(SERVICE_ACCOUNT_KEY_PATH)) {
    const credentials = require(SERVICE_ACCOUNT_KEY_PATH);
    expo = new Expo({
      useFcmV1: true,
      serviceAccountCredentials: credentials,
    });
} else {
    console.warn(`[WARN] Không tìm thấy file FCM credentials tại: ${SERVICE_ACCOUNT_KEY_PATH}. Chức năng thông báo đẩy sẽ không hoạt động.`);
    expo = {
        sendPushNotificationsAsync: async () => {},
        chunkPushNotifications: () => [],
        isExpoPushToken: () => false,
    };
}


const sendPushNotifications = async (pushTokens, title, body, data = {}) => {
    // Lọc ra các token hợp lệ theo định dạng của Expo
    const validPushTokens = pushTokens.filter(token => Expo.isExpoPushToken(token));

    const uniqueValidPushTokens = [...new Set(validPushTokens)];

    if (uniqueValidPushTokens.length === 0) {
        console.log('[Notification] Không có push token hợp lệ nào để gửi đi.');
        const invalidTokens = pushTokens.filter(token => token && !Expo.isExpoPushToken(token));
        if (invalidTokens.length > 0) {
            console.warn(`[Notification] Tìm thấy ${invalidTokens.length} token không hợp lệ (sai định dạng) trong DB:`, invalidTokens);
        }
        return;
    }

    const messages = uniqueValidPushTokens.map(pushToken => ({
        to: pushToken,
        sound: 'default',
        title: title,
        body: body,
        data: data,
    }));

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
        try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
        } catch (error) {
            console.error('Lỗi khi gửi chunk thông báo:', error);
        }
    }

    let receiptIds = [];
    for (const ticket of tickets) {
        if (ticket.status === 'ok' && ticket.id) {
            receiptIds.push(ticket.id);
        } else if (ticket.status === 'error') {
            // Ghi log ngay lập tức nếu Expo từ chối vé gửi
            console.error(
                `[Notification] Không thể xếp hàng thông báo. Lỗi từ Expo: ${ticket.message}`
            );
            if (ticket.details && ticket.details.error) {
                console.error(`[Notification] Chi tiết lỗi: ${ticket.details.error}`);
            }
        }
    }

    if (receiptIds.length > 0) {
        // Trong ứng dụng thực tế, bạn sẽ lưu receiptIds và kiểm tra bằng một tác vụ nền.
        // Ở đây, chúng ta kiểm tra sau 10 giây để gỡ lỗi.
        setTimeout(async () => {
            try {
                const receipts = await expo.getPushNotificationReceiptsAsync(receiptIds);

                for (const receiptId in receipts) {
                    const { status, message, details } = receipts[receiptId];
                    if (status === 'error') {
                        console.error(`[Notification] Gửi thông báo THẤT BẠI. Biên nhận cho vé ${receiptId}:`, message);
                        if (details && details.error) {
                            // Các lỗi phổ biến: DeviceNotRegistered, MessageTooBig, MessageRateExceeded...
                            console.error(`[Notification] Chi tiết lỗi từ Google/Apple: ${details.error}`);
                        }
                    }
                }
            } catch (error) {
                console.error('Lỗi khi kiểm tra biên nhận:', error);
            }
        }, 10000); // Kiểm tra sau 10 giây
    }
};

/**
 * Hàm tổng hợp để gửi thông báo đến một danh sách user ID.
 * @param {number[]} userIds - Mảng các user_id cần gửi thông báo.
 * @param {object} notification - Đối tượng thông báo { title, body, data }.
 */
const sendNotification = async (userIds, notification) => {
    if (!userIds || userIds.length === 0) {
        return;
    }

    try {
        const pushTokens = await userModel.findPushTokensByUserIds(userIds);
        if (pushTokens.length > 0) {
            await sendPushNotifications(pushTokens, notification.title, notification.body, notification.data);
        }
    } catch (error) {
        console.error(`[NotificationService] Lỗi khi gửi thông báo cho userIds ${userIds}:`, error);
    }
};


module.exports = { sendPushNotifications, sendNotification };