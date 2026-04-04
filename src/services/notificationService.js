const { Expo } = require('expo-server-sdk');
const path = require('path');
const userModel = require('../models/userModel');
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
      // experienceId là cần thiết để Expo có thể định danh project khi gửi thông báo Firebase V1
      experienceId: '@phonghopsoapk/conghaisoapp',
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

    // Tạo messages
    const messages = uniqueValidPushTokens.map(pushToken => ({
        to: pushToken,
        sound: 'default',
        title: title,
        body: body,
        data: data,
    }));

    // Gửi từng message một cách độc lập để tránh xung đột experience ID
    const tickets = [];
    for (const message of messages) {
        try {
            const chunks = expo.chunkPushNotifications([message]);
            for (const chunk of chunks) {
                const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            }
        } catch (error) {
            if (error.code === 'PUSH_TOO_MANY_EXPERIENCE_IDS') {
                console.warn(`[Notification] Token ${message.to} thuộc project khác, bỏ qua.`);
            } else {
                console.error(`[Notification] Lỗi khi gửi cho token ${message.to}:`, error.message);
            }
        }
    }

    // Kiểm tra biên nhận và tự động dọn dẹp token rác
    let receiptIds = [];
    const tokenToReceiptMap = {}; // Ánh xạ receiptId -> token để xóa khi cần

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const correspondingToken = messages[i]?.to;

        if (ticket.status === 'ok' && ticket.id) {
            receiptIds.push(ticket.id);
            tokenToReceiptMap[ticket.id] = correspondingToken;
        } else if (ticket.status === 'error') {
            console.error(`[Notification] Không thể xếp hàng thông báo. Lỗi từ Expo: ${ticket.message}`);
            if (ticket.details && ticket.details.error) {
                const errCode = ticket.details.error;
                console.error(`[Notification] Chi tiết lỗi: ${errCode}`);
                // Tự động xóa token không hợp lệ
                if ((errCode === 'DeviceNotRegistered' || errCode === 'InvalidCredentials') && correspondingToken) {
                    userModel.deletePushToken(correspondingToken).catch(e => 
                        console.error(`[Notification] Lỗi khi xóa token rác: ${e.message}`)
                    );
                }
            }
        }
    }

    if (receiptIds.length > 0) {
        setTimeout(async () => {
            try {
                const receipts = await expo.getPushNotificationReceiptsAsync(receiptIds);
                for (const receiptId in receipts) {
                    const { status, message, details } = receipts[receiptId];
                    if (status === 'error') {
                        console.error(`[Notification] Gửi thông báo THẤT BẠI. Biên nhận cho vé ${receiptId}:`, message);
                        if (details && details.error) {
                            console.error(`[Notification] Chi tiết lỗi từ Google/Apple: ${details.error}`);
                            // Tự động xóa token khi thiết bị không còn đăng ký
                            if (details.error === 'DeviceNotRegistered' && tokenToReceiptMap[receiptId]) {
                                userModel.deletePushToken(tokenToReceiptMap[receiptId]).catch(e => 
                                    console.error(`[Notification] Lỗi khi xóa token rác: ${e.message}`)
                                );
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Lỗi khi kiểm tra biên nhận:', error);
            }
        }, 10000);
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