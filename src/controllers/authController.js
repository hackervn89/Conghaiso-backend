const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const redisClient = require('../services/redisService');
const { TOKEN_BLACKLIST_PREFIX } = require('../middleware/authMiddleware');
const logger = require('../services/loggerService');

const login = async (req, res) => {
  const { username, password, clientType } = req.body;
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

    let managedScopes = [];
    if (user.role === 'Secretary') {
      managedScopes = await userModel.getSecretaryScopes(user.user_id);
    } else {
      const leaderScopes = await userModel.getLeaderScopes(user.user_id);
      if (leaderScopes.length > 0) managedScopes = leaderScopes;
    }

    const payload = { userId: user.user_id, username: user.username, role: user.role, managedScopes: managedScopes };
    const tokenExpiresIn = clientType === 'app' ? '30d' : '1d'; 

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: tokenExpiresIn });

    logger.info('Đăng nhập thành công', { userId: user.user_id, username: user.username, clientType });

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
    logger.error('Lỗi đăng nhập', { error: error.message });
    res.status(500).json({ message: 'Đã có lỗi xảy ra trên server.' });
  }
};

//Logout - [CẢI TIẾN] Thêm blacklist token vào Redis
const logout = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const token = req.token; // Token được gắn bởi authMiddleware

    // 1. Xóa push token
    if (userId) {
      await userModel.updatePushToken(userId, null);
    }

    // 2. [BẢO MẬT] Thêm JWT vào blacklist trong Redis
    //    Token sẽ tự hết hạn trong Redis theo đúng thời gian hết hạn của JWT
    if (token && !redisClient.isMock) {
      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await redisClient.set(`${TOKEN_BLACKLIST_PREFIX}${token}`, 'revoked', 'EX', ttl);
            logger.info('Token đã được thêm vào blacklist', { userId, ttl });
          }
        }
      } catch (blacklistError) {
        // Lỗi blacklist không nên ảnh hưởng đến luồng logout chính
        logger.warn('Không thể blacklist token', { error: blacklistError.message });
      }
    }

    res.status(200).json({ message: 'Đăng xuất thành công, token đã bị thu hồi.' });
  } catch (error) {
    logger.error('Lỗi đăng xuất', { error: error.message });
    res.status(500).json({ message: 'Có lỗi xảy ra trong quá trình xử lý đăng xuất.' });
  }
};

const getMe = async (req, res) => {
  const user = req.user;
  let managedScopes = [];
  if (user.role === 'Secretary') {
    managedScopes = await userModel.getSecretaryScopes(user.user_id);
  } else {
    const leaderScopes = await userModel.getLeaderScopes(user.user_id);
    if (leaderScopes.length > 0) managedScopes = leaderScopes;
  }
  
  res.status(200).json({
    userId: user.user_id,
    fullName: user.full_name,
    username: user.username,
    role: user.role,
    managedScopes: managedScopes
  });
};

module.exports = { login, getMe, logout };