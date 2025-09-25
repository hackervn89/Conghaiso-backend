const { Pool } = require('pg');
require('dotenv').config();

let dbConfig;

if (process.env.DATABASE_URL) {
  dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  };
} else {
  
  dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  };
}

const pool = new Pool(dbConfig);


module.exports = {  
  query: (text, params) => pool.query(text, params),  
  getClient: () => pool.connect(),
};