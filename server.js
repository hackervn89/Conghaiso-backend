const dotenv = require('dotenv');
dotenv.config();

const http = require('http');
const { Server } = require("socket.io");

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
const httpServer = http.createServer(app);

// --- ĐẶT MIDDLEWARE DEBUG Ở ĐÂY ---
// Middleware này phải đặt trước CORS và các routes khác
app.use('/socket.io', (req, res, next) => {
  console.log(`[DEBUG] Received ${req.method} request for ${req.originalUrl}`);
  next();
});
// --- KẾT THÚC ---

const PORT = process.env.PORT || 5000; // Đảm bảo cổng là 5000 như bạn đã cấu hình Nginx

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
    // Hoặc nếu origin nằm trong danh sách cho phép
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.error(`[CORS Error] Origin bị từ chối: ${origin}`); // Thêm log lỗi CORS
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

// Áp dụng CORS cho Express API (phải đặt SAU middleware debug)
app.use(cors(corsOptions));

app.use(express.json());

// Cấu hình Socket.IO với CORS
const io = new Server(httpServer, {
  cors: {
    // origin: "*", // Tạm thời dùng "*" để gỡ lỗi triệt để, sau đó đổi lại allowedOrigins
    origin: function (origin, callback) {
        // Tương tự như Express, nhưng linh hoạt hơn cho Socket.IO
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
          console.log(`[Socket CORS] Cho phép origin: ${origin || 'Không có origin'}`);
          callback(null, true);
        } else {
          console.error(`[Socket CORS Error] Origin bị từ chối: ${origin}`);
          callback(new Error('Not allowed by Socket.IO CORS'));
        }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware để inject io instance vào request (dùng cho các controller)
app.use((req, res, next) => {
  req.io = io;
  next();
});

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

// Logic xử lý Socket.IO
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Một client đã kết nối: ${socket.id}`);

  // --- THÊM TRÌNH BẮT LỖI NÀY ---
  socket.on('error', (err) => {
    console.error(`[Socket.IO] LỖI SOCKET (${socket.id}):`, err.message);
  });
  // --- KẾT THÚC ---

  socket.on('join_meeting_room', (meetingId) => {
    // --- THÊM TRY...CATCH Ở ĐÂY ---
    try {
        const roomName = `meeting-room-${meetingId}`;
        socket.join(roomName);
        console.log(`[Socket.IO] Client ${socket.id} đã tham gia phòng: ${roomName}`);
    } catch (joinError) {
        console.error(`[Socket.IO] LỖI KHI JOIN ROOM (${socket.id}, meetingId: ${meetingId}):`, joinError.message);
        // Có thể ngắt kết nối client nếu không join được phòng
        // socket.disconnect(true);
    }
    // --- KẾT THÚC TRY...CATCH ---
  });

  socket.on('leave_meeting_room', (meetingId) => {
     try { // Thêm try...catch cho leave room
        const roomName = `meeting-room-${meetingId}`;
        socket.leave(roomName);
        console.log(`[Socket.IO] Client ${socket.id} đã rời phòng: ${roomName}`);
    } catch (leaveError) {
         console.error(`[Socket.IO] LỖI KHI LEAVE ROOM (${socket.id}, meetingId: ${meetingId}):`, leaveError.message);
    }
  });

  // --- THÊM THAM SỐ 'reason' VÀO ĐÂY ---
  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] Client đã ngắt kết nối: ${socket.id}. Lý do: ${reason}`);
  });
  // --- KẾT THÚC ---
});

httpServer.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);

  // Kích hoạt các tác vụ nền khi server khởi động
  cronService.initializeCronJobs();
});