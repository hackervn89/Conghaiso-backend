const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const path = require('path');

const http = require('http');
const { Server } = require("socket.io");

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');                      // [BẢO MẬT] HTTP Security Headers
const rateLimit = require('express-rate-limit');        // [BẢO MẬT] Chống brute-force
const logger = require('./src/services/loggerService'); // [CẢI TIẾN] Structured Logging
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
const adminDocumentRoutes = require('./src/routes/adminDocumentRoutes');
const anchorKeywordRoutes = require('./src/routes/anchorKeywordRoutes'); // [AI-FEATURE]
const geminiRoutes = require('./src/routes/geminiRoutes'); // [AI-FEATURE]
const chatRoutes = require('./src/routes/chatRoutes'); // [AI-FEATURE] - Route mới cho quản lý phiên chat

const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require('ioredis'); // Import ioredis trực tiếp để tạo subClient
const redisClient = require("./src/services/redisService"); // Client Redis chính cho caching


const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);

// --- ĐẶT MIDDLEWARE DEBUG Ở ĐÂY ---
app.use('/socket.io', (req, res, next) => {
  logger.debug(`Socket.IO ${req.method} ${req.originalUrl}`);
  next();
});

const PORT = process.env.PORT || 5000;

// ========================= [BẢO MẬT] HELMET =========================
// Thêm các HTTP Security Headers: X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security, X-XSS-Protection, v.v.
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Cho phép tải file từ API
  contentSecurityPolicy: false, // Tắt CSP vì frontend/app tải từ nhiều nguồn
}));

// ========================= [BẢO MẬT] RATE LIMITING =========================
// Rate limit CHUNG cho toàn bộ API: 150 requests / 15 phút / IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau 15 phút.' },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded`, { ip: req.ip, path: req.originalUrl });
    res.status(options.statusCode).json(options.message);
  }
});
app.use('/api', globalLimiter);

// Rate limit RIÊNG cho Login: 10 lần / 15 phút / IP (chống brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Quá nhiều lần đăng nhập thất bại, vui lòng thử lại sau 15 phút.' },
  handler: (req, res, next, options) => {
    logger.warn(`Login rate limit exceeded`, { ip: req.ip, username: req.body?.username });
    res.status(options.statusCode).json(options.message);
  }
});
app.use('/api/auth/login', loginLimiter);

// ========================= CORS =========================
const allowedOrigins = [
  'http://localhost:5173',
  'http://103.1.236.206',
  'https://conghaiso.vn',
  'https://www.conghaiso.vn'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked`, { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use('/uploads', express.static(process.env.STORAGE_PATH));
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

  logger.info('Socket.IO Redis Adapter đã được kích hoạt.');
  io.adapter(createAdapter(redisClient, subClient));

  subClient.on('error', (err) => logger.error('Socket.IO Redis Sub Client error', { error: err.message }));
} else {
  logger.warn('Socket.IO đang sử dụng Memory Adapter mặc định (Redis bị tắt).');
}
// --- CẢI TIẾN: THÊM MIDDLEWARE XÁC THỰC CHO SOCKET.IO ---
io.use((socket, next) => {
  // Lấy token từ handshake query hoặc auth headers
  const token = socket.handshake.auth.token || socket.handshake.headers['x-auth-token'];

  if (!token) {
    logger.warn('Socket Auth: Từ chối kết nối - Không có token.');
    return next(new Error('Authentication error: No token provided.'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    logger.warn('Socket Auth: Token không hợp lệ', { error: err.message });
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
app.use('/api/admin-documents', adminDocumentRoutes);
app.use('/api/anchor-keywords', anchorKeywordRoutes); // [AI-FEATURE]
app.use('/api', geminiRoutes); // [AI-FEATURE] for /api/chat
app.use('/api/chat', chatRoutes); // [AI-FEATURE] - Sử dụng route quản lý phiên chat

app.get('/api', (req, res) => {
  res.json({ message: 'Chào mừng đến với API Công Hải Số!' });
});

// Import and check database connection
const { loadKeywordsToCache } = require('./src/config/keywordCache');
const db = require('./src/config/database');

const initializeApp = async () => {
  try {
    const client = await db.getClient();
    logger.info('Đã kết nối thành công đến cơ sở dữ liệu.');
    client.release();

    await loadKeywordsToCache();
  } catch (err) {
    logger.error('Không thể khởi tạo ứng dụng', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

// Logic xử lý Socket.IO
io.on('connection', (socket) => {
  logger.info(`Socket.IO client connected`, { socketId: socket.id, userId: socket.user?.userId });

  socket.on('error', (err) => {
    logger.error(`Socket error`, { socketId: socket.id, error: err.message });
  });

  socket.on('join_meeting_room', (meetingId) => {
    try {
      const roomName = `meeting-room-${meetingId}`;
      socket.join(roomName);
      logger.debug(`Client joined room`, { socketId: socket.id, room: roomName });
    } catch (joinError) {
      logger.error(`Error joining room`, { socketId: socket.id, meetingId, error: joinError.message });
    }
  });

  socket.on('leave_meeting_room', (meetingId) => {
    try {
      const roomName = `meeting-room-${meetingId}`;
      socket.leave(roomName);
      logger.debug(`Client left room`, { socketId: socket.id, room: roomName });
    } catch (leaveError) {
      logger.error(`Error leaving room`, { socketId: socket.id, meetingId, error: leaveError.message });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Socket.IO client disconnected`, { socketId: socket.id, reason });
  });
});

// --- LOGGING TOÀN CỤC ---
process.on('uncaughtException', (err, origin) => {
  logger.error(`FATAL: Uncaught Exception`, { origin, error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('FATAL: Unhandled Rejection', { reason: reason?.message || reason });
});

initializeApp().then(() => {
  httpServer.listen(PORT, () => {
    logger.info(`🚀 Server đang chạy tại http://localhost:${PORT}`);
    cronService.initializeCronJobs();
  });
});