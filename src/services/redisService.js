const Redis = require('ioredis');
require('dotenv').config();

// Đọc thông tin kết nối từ biến môi trường, với các giá trị mặc định
const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD, // Bỏ comment nếu Redis của bạn có mật khẩu
  maxRetriesPerRequest: 3, // Giảm số lần thử lại để tránh treo yêu cầu quá lâu
};

// Tạo một redis client instance
const redis = new Redis(redisConfig);

redis.on('connect', () => {
  console.log('Đã kết nối thành công đến Redis server.');
});

redis.on('error', (err) => {
  console.error('Không thể kết nối đến Redis:', err);
});

module.exports = redis;
