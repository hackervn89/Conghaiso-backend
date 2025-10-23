const Redis = require('ioredis');
require('dotenv').config();

// Đọc thông tin kết nối từ biến môi trường, với các giá trị mặc định
// Thêm biến môi trường để kiểm soát việc bật/tắt Redis caching
const disableRedisCache = process.env.DISABLE_REDIS_CACHE === 'true';

let redis;

if (disableRedisCache) {
  console.warn('⚠️ Redis caching đã bị TẮT bởi biến môi trường DISABLE_REDIS_CACHE.');
  // Tạo một đối tượng mock Redis để các lệnh gọi .get(), .set(), .del() không gây lỗi
  redis = {
    get: async () => null,
    set: async () => {},
    del: async () => {},
    on: () => {},
    // [SỬA LỖI] Thêm các phương thức rỗng để tương thích với các thư viện khác
    // như socket.io-redis-adapter, tránh lỗi "is not a function"
    publish: () => {},
    subscribe: () => {},
    psubscribe: () => {},
    unsubscribe: () => {},
    punsubscribe: () => {},
    isMock: true, // Thêm cờ để nhận biết đây là đối tượng giả
  };
} else {
  const redisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD, // Bỏ comment nếu Redis của bạn có mật khẩu
    maxRetriesPerRequest: 3, // Giảm số lần thử lại để tránh treo yêu cầu quá lâu
  };

  // Tạo một redis client instance thực sự
  redis = new Redis(redisConfig);

  redis.on('connect', () => {
    console.log('✅ Đã kết nối thành công đến Redis server.');
  });

  redis.on('error', (err) => {
    console.error('❌ Không thể kết nối đến Redis:', err);
  });
}

module.exports = redis;
