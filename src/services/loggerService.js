const { createLogger, format, transports } = require('winston');
const path = require('path');

// Thư mục logs nằm ở gốc backend
const LOG_DIR = path.join(__dirname, '../../logs');

/**
 * Logger chuyên nghiệp dùng Winston.
 * - Ghi log ra console với màu sắc.
 * - Ghi lỗi vào file `logs/error.log`.
 * - Ghi tất cả log vào file `logs/combined.log`.
 * - File log tự động xoay vòng theo dung lượng (5MB / file, tối đa 5 file).
 */
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'conghaiso-api' },
  transports: [
    // Ghi lỗi (error) ra file riêng
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    // Ghi tất cả log ra file chung
    new transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// Khi KHÔNG ở production, thêm log ra console với format dễ đọc
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, service, ...rest }) => {
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
          return `${timestamp} [${level}] ${message}${extra}`;
        })
      ),
    })
  );
} else {
  // Ở production, vẫn log ra console nhưng ở format JSON (tiện cho log aggregator)
  logger.add(
    new transports.Console({
      format: format.combine(format.timestamp(), format.json()),
    })
  );
}

module.exports = logger;
