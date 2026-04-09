const Joi = require('joi');

/**
 * Schema validate cho API đăng nhập.
 */
const loginSchema = Joi.object({
  username: Joi.string().trim().min(3).max(50).required()
    .label('Tên đăng nhập'),
  password: Joi.string().min(6).max(128).required()
    .label('Mật khẩu'),
  clientType: Joi.string().valid('web', 'app').optional()
    .label('Loại client'),
});

module.exports = { loginSchema };
