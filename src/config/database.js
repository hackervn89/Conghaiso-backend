const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Xuất pool ra để các file khác trong dự án có thể sử dụng
module.exports = {
  // Hàm query cũ để chạy các lệnh đơn giản
  query: (text, params) => pool.query(text, params),
  // Hàm mới để "mượn" một client từ pool cho transaction
  getClient: () => pool.connect(),
};