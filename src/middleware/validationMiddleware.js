/**
 * Middleware factory: Tự động validate request body/query/params dựa trên Joi schema.
 * 
 * Cách dùng trong route:
 *   const { validate } = require('../middleware/validationMiddleware');
 *   const { loginSchema } = require('../middleware/schemas/authSchema');
 *   router.post('/login', validate(loginSchema), authController.login);
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const dataToValidate = req[source];
    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,     // Trả về TẤT CẢ lỗi, không dừng ở lỗi đầu tiên
      stripUnknown: true,    // Loại bỏ các field không khai báo trong schema (chống injection)
      messages: {
        'any.required': '{{#label}} là bắt buộc.',
        'string.empty': '{{#label}} không được để trống.',
        'string.min': '{{#label}} phải có ít nhất {{#limit}} ký tự.',
        'string.max': '{{#label}} không được vượt quá {{#limit}} ký tự.',
      }
    });

    if (error) {
      const details = error.details.map(d => d.message);
      return res.status(400).json({
        message: 'Dữ liệu đầu vào không hợp lệ.',
        errors: details
      });
    }

    // Ghi đè request data bằng dữ liệu đã được sanitize
    req[source] = value;
    next();
  };
};

module.exports = { validate };
