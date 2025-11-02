const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

const login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Vui lòng cung cấp tên đăng nhập và mật khẩu.' });
  }
  try {
    const user = await userModel.findByUsername(username);
    if (!user) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }

    // [SỬA LỖI QUAN TRỌNG]
    // Lấy managedScopes TRƯỚC KHI tạo token để đưa vào payload.
    let managedScopes = [];
    // Lấy phạm vi quản lý cho cả Secretary và Leader
    if (user.role === 'Secretary') {
      managedScopes = await userModel.getSecretaryScopes(user.user_id);
    } else {
      const leaderScopes = await userModel.getLeaderScopes(user.user_id);
      if (leaderScopes.length > 0) managedScopes = leaderScopes;
    }

    // Tạo payload đầy đủ thông tin
    const payload = { userId: user.user_id, username: user.username, role: user.role, managedScopes: managedScopes };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({
      message: 'Đăng nhập thành công!',
      token: token,
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        username: user.username,
        role: user.role,
        managedScopes: managedScopes,
      }
    });
  } catch (error) {
    console.error('Lỗi trong quá trình đăng nhập:', error);
    res.status(500).json({ message: 'Đã có lỗi xảy ra trên server.' });
  }
};

//Logout
const logout = async (req, res) => {
  try {
    // req.user được middleware 'protect' gắn vào từ token
    const userId = req.user.user_id;

    if (userId) {
      // Gọi hàm từ userModel để cập nhật push_token thành NULL
      await userModel.updatePushToken(userId, null);
      console.log(`[Auth] Đã xoá push token cho người dùng: ${userId}`);
    }

    res.status(200).json({ message: 'Đăng xuất thành công, push token đã được xoá.' });
  } catch (error) {
    console.error('Lỗi trong quá trình đăng xuất:', error);
    // Trả về lỗi nhưng không quá chi tiết để bảo mật
    res.status(500).json({ message: 'Có lỗi xảy ra trong quá trình xử lý đăng xuất.' });
  }
};

// --- SỬA LỖI QUAN TRỌNG: Đảm bảo /me trả về đủ thông tin ---
const getMe = async (req, res) => {
  const user = req.user;
  let managedScopes = [];
  // Lấy phạm vi quản lý cho cả Secretary và Leader
  if (user.role === 'Secretary') {
    managedScopes = await userModel.getSecretaryScopes(user.user_id);
  } else {
    // Kiểm tra xem người dùng có phải là Leader của đơn vị nào không
    const leaderScopes = await userModel.getLeaderScopes(user.user_id);
    if (leaderScopes.length > 0) managedScopes = leaderScopes;
  }
  
  // Trả về một đối tượng user đầy đủ, nhất quán với API login
  res.status(200).json({
    userId: user.user_id,
    fullName: user.full_name,
    username: user.username,
    role: user.role,
    managedScopes: managedScopes
  });
};

module.exports = { login, getMe, logout };