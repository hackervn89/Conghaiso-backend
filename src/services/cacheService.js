const NodeCache = require('node-cache');

// stdTTL: Thời gian sống mặc định (giây) cho mỗi cache item. 0 = không bao giờ hết hạn.
// checkperiod: Chu kỳ (giây) để tự động kiểm tra và xóa các cache item đã hết hạn.
const cache = new NodeCache({ stdTTL: 0, checkperiod: 120 });

console.log('Cache service initialized.');

module.exports = cache;
