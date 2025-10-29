const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken'); // Thêm JWT

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
const knowledgeRoutes = require('./src/routes/knowledgeRoutes'); // [AI-FEATURE]
const anchorKeywordRoutes = require('./src/routes/anchorKeywordRoutes'); // [AI-FEATURE]
const geminiRoutes = require('./src/routes/geminiRoutes'); // [AI-FEATURE]

const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require('ioredis'); // Import ioredis trực tiếp để tạo subClient
const redisClient = require("./src/services/redisService"); // Client Redis chính cho caching


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
  // [CẢI TIẾN] Tắt việc phục vụ file client, đây là best practice về bảo mật
  serveClient: false,
  // [CẢI TIẾN] Khai báo rõ các transport được hỗ trợ
  transports: ['polling', 'websocket'],
  cors: {
    origin: function (origin, callback) {
      // Trong môi trường dev, cho phép không có origin (ví dụ: Postman)
      if (process.env.NODE_ENV !== 'production' && !origin) {
        console.log(`[Socket CORS] Cho phép request không có origin (DEV mode)`);
        return callback(null, true);
      }
      if (allowedOrigins.indexOf(origin) !== -1) {
        console.log(`[Socket CORS] Cho phép origin: ${origin}`);
        callback(null, true);
      } else {
        console.error(`[Socket CORS Error] Origin bị từ chối: ${origin}`);
        // [SỬA LỖI] Theo tài liệu của Socket.IO, khi từ chối, callback nên được gọi với tham số thứ hai là `false`.
        callback(null, false);
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  // [CẢI TIẾN] Thêm một lớp kiểm tra request để tăng cường bảo mật và ổn định
  // Giúp từ chối các kết nối không mong muốn sớm hơn, giảm khả năng gây lỗi ECONNABORTED
  allowRequest: (req, callback) => {
    const origin = req.headers.origin || req.headers.referer;
    const isAllowed = process.env.NODE_ENV !== 'production' || (origin && allowedOrigins.some(allowed => origin.startsWith(allowed)));
    console.log(`[Socket AllowRequest] Kiểm tra origin: ${origin}. Được phép: ${isAllowed}`);
    callback(null, isAllowed);
  }
});

// [SỬA LỖI] Chỉ cấu hình Redis Adapter khi Redis không bị tắt
if (!redisClient.isMock) {
  // [SỬA LỖI TRIỆT ĐỂ] Cách đúng và được khuyến nghị để tạo sub client với `ioredis`
  // là gọi phương thức `.duplicate()`. Phương thức này tạo ra một kết nối mới
  // với cùng cấu hình, dành riêng cho pub/sub.
  const subClient = redisClient.duplicate();

  console.log('[Socket.IO] Redis Adapter đã được kích hoạt.');
  io.adapter(createAdapter(redisClient, subClient));

  // [CẢI TIẾN] Thêm trình xử lý lỗi cho các client Redis để debug tốt hơn
  subClient.on('error', (err) => console.error('[Socket.IO] Lỗi Redis Sub Client:', err));
} else {
  console.warn('[Socket.IO] Đang sử dụng Memory Adapter mặc định (Redis bị tắt).');
}
// --- CẢI TIẾN: THÊM MIDDLEWARE XÁC THỰC CHO SOCKET.IO ---
io.use((socket, next) => {
  // Lấy token từ handshake query hoặc auth headers
  const token = socket.handshake.auth.token || socket.handshake.headers['x-auth-token'];

  if (!token) {
    console.error(`[Socket Auth] Từ chối kết nối: Không có token.`);
    return next(new Error('Authentication error: No token provided.'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // Gắn thông tin user vào socket để sử dụng sau này
    next();
  } catch (err) {
    console.error(`[Socket Auth] Từ chối kết nối: Token không hợp lệ hoặc đã hết hạn. Lỗi: ${err.message}`);
    // Trả về lỗi cho client một cách an toàn
    return next(new Error('Authentication error: Invalid or expired token.'));
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
app.use('/api/knowledge', knowledgeRoutes); // [AI-FEATURE]
app.use('/api/anchor-keywords', anchorKeywordRoutes); // [AI-FEATURE]
app.use('/api', geminiRoutes); // [AI-FEATURE] for /api/chat

app.get('/api', (req, res) => {
  res.json({ message: 'Chào mừng đến với API Công Hải Số!' });
});

// Import and check database connection
const { loadKeywordsToCache } = require('./src/config/keywordCache');
const db = require('./src/config/database');

const initializeApp = async () => {
    try {
        const client = await db.getClient();
        console.log('Đã kết nối thành công đến cơ sở dữ liệu.');
        client.release();

        // Nạp cache từ khóa neo sau khi kết nối CSDL thành công
        await loadKeywordsToCache();
    } catch (err) {
        console.error('Không thể khởi tạo ứng dụng:', err);
        process.exit(1); // Thoát nếu không kết nối được CSDL hoặc nạp cache
    }
};

// Logic xử lý Socket.IO
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Một client đã kết nối: ${socket.id}`);

  // [SỬA LỖI] Thêm trình xử lý lỗi chung cho mỗi socket để ngăn server crash
  socket.on('error', (err) => {
    console.error(`[Socket.IO] LỖI SOCKET (${socket.id}):`, err.message);
  });

  socket.on('join_meeting_room', (meetingId) => {
    // [SỬA LỖI] Bọc logic trong try...catch để bắt các lỗi không mong muốn
    try {
        const roomName = `meeting-room-${meetingId}`;
        socket.join(roomName);
        console.log(`[Socket.IO] Client ${socket.id} đã tham gia phòng: ${roomName}`);
    } catch (joinError) {
        console.error(`[Socket.IO] LỖI KHI JOIN ROOM (${socket.id}, meetingId: ${meetingId}):`, joinError.message);
    }
  });

  socket.on('leave_meeting_room', (meetingId) => {
     // [SỬA LỖI] Bọc logic trong try...catch
     try {
        const roomName = `meeting-room-${meetingId}`;
        socket.leave(roomName);
        console.log(`[Socket.IO] Client ${socket.id} đã rời phòng: ${roomName}`);
    } catch (leaveError) {
         console.error(`[Socket.IO] LỖI KHI LEAVE ROOM (${socket.id}, meetingId: ${meetingId}):`, leaveError.message);
    }
  });

  // [CẢI TIẾN] Thêm tham số 'reason' để biết lý do ngắt kết nối
  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] Client đã ngắt kết nối: ${socket.id}. Lý do: ${reason}`);
    // Lý do phổ biến:
    // - "client namespace disconnect": Client chủ động gọi socket.disconnect()
    // - "server namespace disconnect": Server chủ động gọi socket.disconnect()
    // - "transport close": Client đóng tab trình duyệt, mất mạng, F5...
    // - "ping timeout": Mạng của client quá yếu, không phản hồi lại ping của server
  });
});

// --- THÊM LOGGING TOÀN CỤC ĐỂ DEBUG ---
// Bắt các lỗi không được xử lý trong toàn bộ ứng dụng
process.on('uncaughtException', (err, origin) => {
  console.error(`[FATAL] Lỗi UNCAUGHT EXCEPTION tại ${origin}:`, err);
  // Trong môi trường production, bạn có thể muốn khởi động lại server ở đây.
  // process.exit(1);
});

// Bắt các promise bị reject mà không có .catch()
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Lỗi UNHANDLED REJECTION:', reason);
});

initializeApp().then(() => {
    httpServer.listen(PORT, () => {
        console.log(`Server đang chạy tại http://localhost:${PORT}`);

        // Kích hoạt các tác vụ nền khi server khởi động
        cronService.initializeCronJobs();
    });
});