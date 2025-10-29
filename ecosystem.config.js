module.exports = {
  apps: [{
    name: "conghaiso-api", // Tên ứng dụng phải khớp với tên bạn đang dùng
    script: "./server.js",   // Đường dẫn đến file khởi động
    // Các tùy chọn khác
    instances: 1,
    autorestart: true,
    watch: false,
    env_production: {
      NODE_ENV: "production" // Quan trọng: Đặt biến môi trường ở đây
    }
  }]
};