const { Expo } = require('expo-server-sdk');
const path = require('path');
const fs = require('fs');

// Đường dẫn đến file "chìa khóa" Firebase V1
const SERVICE_ACCOUNT_KEY_PATH = path.join(process.cwd(), process.env.GOOGLE_FCM_CREDENTIALS_PATH);

let expo;
// Kiểm tra xem file credentials có tồn tại không trước khi khởi tạo
if (fs.existsSync(SERVICE_ACCOUNT_KEY_PATH)) {
    expo = new Expo({
      useFcmV1: true,
      serviceAccountCredentials: require(SERVICE_ACCOUNT_KEY_PATH),
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
    const validPushTokens = pushTokens.filter(token => Expo.isExpoPushToken(token));

    if (validPushTokens.length === 0) {
        console.log('[Notification] Không có push token hợp lệ nào để gửi đi.');
        return;
    }

    const messages = validPushTokens.map(pushToken => ({
        to: pushToken,
        sound: 'default',
        title: title,
        body: body,
        data: data,
    }));

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    console.log(`[Notification] Đang chuẩn bị gửi ${messages.length} thông báo...`);

    for (const chunk of chunks) {
        try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
            console.log('[Notification] Đã gửi thành công một chunk thông báo và nhận được "vé gửi".');
        } catch (error) {
            console.error('Lỗi khi gửi chunk thông báo:', error);
        }
    }

    // --- LOGIC MỚI: KIỂM TRA BIÊN NHẬN ĐỂ GỠ LỖI CHI TIẾT ---
    let receiptIds = [];
    for (const ticket of tickets) {
        if (ticket.status === 'ok' && ticket.id) {
            receiptIds.push(ticket.id);
        }
    }

    if (receiptIds.length > 0) {
        console.log(`[Notification] Đã lên lịch kiểm tra "biên nhận" cho ${receiptIds.length} vé gửi.`);
        // Trong ứng dụng thực tế, bạn sẽ lưu receiptIds và kiểm tra bằng một tác vụ nền.
        // Ở đây, chúng ta kiểm tra sau 15 giây để gỡ lỗi.
        setTimeout(async () => {
            try {
                console.log('[Notification] Đang kiểm tra biên nhận từ máy chủ Expo...');
                const receipts = await expo.getPushNotificationReceiptsAsync(receiptIds);
                console.log('[Notification] Kết quả kiểm tra biên nhận:', receipts);

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

module.exports = { sendPushNotifications };