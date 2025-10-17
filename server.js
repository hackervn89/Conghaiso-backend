const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const cronService = require('./src/services/cronService'); 
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const meetingRoutes = require('./src/routes/meetingRoutes');
const organizationRoutes = require('./src/routes/organizationRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const taskRoutes = require('./src/routes/taskRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const summarizeRoutes = require('./src/routes/summarizeRoutes');
const fileRoutes = require('./src/routes/fileRoutes');
const draftRoutes = require('./src/routes/draftRoutes');


const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình CORS chi tiết để chấp nhận các tên miền cụ thể
const allowedOrigins = [
  'http://localhost:5173',    // Giữ lại cho môi trường development
  'http://103.1.236.206',     // Cho phép truy cập qua IP
  'https://conghaiso.vn',      // Tên miền chính của bạn
  'https://www.conghaiso.vn'   // Tên miền có www
];

const corsOptions = {
  origin: function (origin, callback) {
    // Luôn cho phép các request không có origin (ví dụ: mobile apps, Postman)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

app.use(cors());
app.use(express.json());

// ... (sử dụng các routes)
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/summarize', summarizeRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/drafts', draftRoutes);

app.get('/api', (req, res) => {
  res.json({ message: 'Chào mừng đến với API Công Hải Số!' });
});

// Import and check database connection
const db = require('./src/config/database');
db.getClient()
  .then(client => {
    console.log('Đã kết nối thành công đến cơ sở dữ liệu.');
    client.release();
  })
  .catch(err => {
    console.error('Không thể kết nối đến cơ sở dữ liệu:', err);
  });

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
  
  // Kích hoạt các tác vụ nền khi server khởi động
  cronService.initializeCronJobs(); 
});