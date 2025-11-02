const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

// Middleware 1: Kiểm tra token và xác thực người dùng
const authenticate = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Lấy thông tin mới nhất của user từ DB để đảm bảo không dùng dữ liệu cũ
      const freshUserFromDb = await userModel.findById(decoded.userId);

      if (!freshUserFromDb) {
        return res.status(401).json({ message: 'Người dùng không tồn tại.' });
      }

      // [SỬA LỖI TRIỆT ĐỂ]
      // Gán đối tượng người dùng từ CSDL làm cơ sở.
      req.user = freshUserFromDb;
      // Sau đó, chỉ gắn thêm thuộc tính 'managedScopes' từ token đã giải mã vào.
      // Điều này đảm bảo tính nhất quán của đối tượng user và bổ sung đúng quyền hạn.
      req.user.managedScopes = decoded.managedScopes;

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
    next(); // Có quyền, cho phép đi tiếp
  };
};

module.exports = { authenticate, authorize };