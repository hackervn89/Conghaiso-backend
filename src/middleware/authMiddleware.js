const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const redisClient = require('../services/redisService');

const TOKEN_BLACKLIST_PREFIX = 'bl_token:';

// Middleware 1: Kiểm tra token và xác thực người dùng
const authenticate = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // [BẢO MẬT] Kiểm tra token blacklist trong Redis
      if (!redisClient.isMock) {
        const isBlacklisted = await redisClient.get(`${TOKEN_BLACKLIST_PREFIX}${token}`);
        if (isBlacklisted) {
          return res.status(401).json({ message: 'Token đã bị thu hồi, vui lòng đăng nhập lại.' });
        }
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Lấy thông tin mới nhất của user từ DB
      const freshUserFromDb = await userModel.findById(decoded.userId);

      if (!freshUserFromDb) {
        return res.status(401).json({ message: 'Người dùng không tồn tại.' });
      }

      req.user = freshUserFromDb;
      req.user.managedScopes = decoded.managedScopes;
      req.token = token; // Lưu token để dùng khi logout

      next();
    } catch (error) {
      console.error('Lỗi xác thực JWT:', error.name);
      return res.status(401).json({ message: 'Token không hợp lệ, không có quyền truy cập.' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Không tìm thấy token, không có quyền truy cập.' });
  }
};

// Middleware 2: Phân quyền dựa trên vai trò
const authorize = (roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
        return res.status(403).json({ message: 'Lỗi xác thực: không tìm thấy vai trò người dùng.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Từ chối truy cập. Yêu cầu vai trò là một trong các quyền sau: ${roles.join(', ')}.` 
      });
    }
    next();
  };
};

module.exports = { authenticate, authorize, TOKEN_BLACKLIST_PREFIX };