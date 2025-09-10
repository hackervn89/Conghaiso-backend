const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

// Middleware 1: Kiểm tra token và xác thực người dùng
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Gắn thông tin user (trừ password) vào request để các hàm sau có thể dùng
      req.user = await userModel.findById(decoded.userId); 

      if (!req.user) {
        return res.status(401).json({ message: 'Người dùng không tồn tại.' });
      }

      next(); // Token hợp lệ, cho phép đi tiếp
    } catch (error) {
      console.error('Lỗi xác thực JWT:', error.name);
      return res.status(401).json({ message: 'Token không hợp lệ, không có quyền truy cập.' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Không tìm thấy token, không có quyền truy cập.' });
  }
};

// Middleware 2: Kiểm tra vai trò Admin
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'Admin') {
    next(); // Là Admin, cho phép đi tiếp
  } else {
    res.status(403).json({ message: 'Yêu cầu quyền Admin.' });
  }
};

module.exports = { protect, isAdmin };

