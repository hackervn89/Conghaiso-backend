const db = require('./database');

let anchorKeywordSet = new Set();

/**
 * Chuẩn hóa văn bản: chuyển thành chữ thường, loại bỏ dấu tiếng Việt.
 * @param {string} text - Văn bản đầu vào.
 * @returns {string} - Văn bản đã được chuẩn hóa.
 */
function normalizeText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd');
}

/**
 * Tải các từ khóa neo từ CSDL vào bộ đệm (Set) in-memory.
 * Hàm này được gọi một lần khi server khởi động.
 */
async function loadKeywordsToCache() {
    try {
        console.log('[Cache] Bắt đầu nạp các từ khóa neo vào bộ đệm...');
        const { rows } = await db.query('SELECT keyword FROM anchor_keywords');
        const keywords = rows.map(row => row.keyword);
        anchorKeywordSet = new Set(keywords);
        console.log(`[Cache] ✅ Đã nạp thành công ${anchorKeywordSet.size} từ khóa neo vào bộ đệm.`);
    } catch (error) {
        console.error('❌ Lỗi nghiêm trọng: Không thể nạp từ khóa neo vào bộ đệm. Chức năng AI có thể bị ảnh hưởng.', error);
        // Trong môi trường production, bạn có thể muốn dừng server ở đây
        // process.exit(1);
    }
}

/**
 * Kiểm tra xem một chuỗi đã chuẩn hóa có chứa bất kỳ từ khóa neo nào không.
 * @param {string} normalizedPrompt - Chuỗi đầu vào đã được chuẩn hóa.
 * @returns {boolean} - True nếu tìm thấy, ngược lại là false.
 */
function checkAnchorKeyword(normalizedPrompt) {
    for (const keyword of anchorKeywordSet) {
        if (normalizedPrompt.includes(keyword)) {
            return true;
        }
    }
    return false;
}

module.exports = {
    normalizeText,
    loadKeywordsToCache,
    checkAnchorKeyword,
};