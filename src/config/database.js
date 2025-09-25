const { Pool } = require('pg');
require('dotenv').config();

let dbConfig;

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

// Enhance the config with pooling options from environment variables or defaults
const poolConfig = {
  ...dbConfig,
  max: process.env.DB_POOL_MAX || 25,
  idleTimeoutMillis: process.env.DB_POOL_IDLE_TIMEOUT || 30000,
  connectionTimeoutMillis: process.env.DB_POOL_CONNECTION_TIMEOUT || 20000,
};

const pool = new Pool(poolConfig);

// Log pool creation for verification
console.log(`Database pool created with max connections: ${poolConfig.max}`);

// Xuất pool ra để các file khác trong dự án có thể sử dụng
module.exports = {
  // Hàm query cũ để chạy các lệnh đơn giản
  query: (text, params) => pool.query(text, params),
  // Hàm mới để "mượn" một client từ pool cho transaction
  getClient: () => pool.connect(),
};