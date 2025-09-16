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


const app = express();
const PORT = process.env.PORT || 3000;

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

app.get('/api', (req, res) => {
  res.json({ message: 'Chào mừng đến với API Phòng Họp Số!' });
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
  
  // Kích hoạt các tác vụ nền khi server khởi động
  cronService.initializeCronJobs(); // <-- Dòng mới
});