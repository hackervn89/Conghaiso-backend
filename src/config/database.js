const { Pool } = require('pg');
require('dotenv').config();

// Create a configuration object
let dbConfig;

// If a DATABASE_URL environment variable is available (like on Render), use it.
if (process.env.DATABASE_URL) {
  dbConfig = {
    connectionString: process.env.DATABASE_URL,
    // Render requires SSL connections, and this setting is often necessary
    // for Node.js applications to connect to Render's PostgreSQL.
    ssl: {
      rejectUnauthorized: false,
    },
  };
} else {
  // Otherwise, use the local development variables from the .env file.
  dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  };
}

const pool = new Pool(dbConfig);

// Xuất pool ra để các file khác trong dự án có thể sử dụng
module.exports = {
  // Hàm query cũ để chạy các lệnh đơn giản
  query: (text, params) => pool.query(text, params),
  // Hàm mới để "mượn" một client từ pool cho transaction
  getClient: () => pool.connect(),
};