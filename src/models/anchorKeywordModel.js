const db = require('../config/database');
const { normalizeText } = require('../config/keywordCache');

/**
 * Tạo một từ khóa neo mới.
 * @param {object} data - Dữ liệu từ khóa { keyword, type }.
 * @returns {Promise<object>} - Từ khóa vừa được tạo.
 */
const create = async ({ keyword, type }) => {
    const normalized = normalizeText(keyword);
    if (!normalized) {
        throw new Error('Keyword không được để trống.');
    }
    const query = `
        INSERT INTO anchor_keywords (keyword, type)
        VALUES ($1, $2)
        RETURNING *;
    `;
    const { rows } = await db.query(query, [normalized, type]);
    return rows[0];
};

/**
 * Tìm tất cả từ khóa neo với phân trang và tìm kiếm.
 * @param {object} options - Tùy chọn { page, limit, searchTerm }.
 * @returns {Promise<object>} - Đối tượng chứa danh sách từ khóa và thông tin phân trang.
 */
const findAll = async ({ page = 1, limit = 15, searchTerm = '' }) => {
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = '';

    if (searchTerm) {
        whereClause = `WHERE keyword ILIKE $1 OR type ILIKE $1`;
        params.push(`%${searchTerm}%`);
    }

    const countQuery = `SELECT COUNT(*) FROM anchor_keywords ${whereClause}`;
    const dataQuery = `
        SELECT * FROM anchor_keywords
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countResult, dataResult] = await Promise.all([
        db.query(countQuery, countParams),
        db.query(dataQuery, dataParams)
    ]);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    return {
        keywords: dataResult.rows,
        currentPage: page,
        totalPages,
        totalItems
    };
};

/**
 * Cập nhật một từ khóa neo.
 * @param {number} id - ID của từ khóa.
 * @param {object} data - Dữ liệu cập nhật { keyword, type }.
 * @returns {Promise<object|null>} - Từ khóa đã cập nhật hoặc null nếu không tìm thấy.
 */
const update = async (id, { keyword, type }) => {
    const normalized = normalizeText(keyword);
    if (!normalized) {
        throw new Error('Keyword không được để trống.');
    }
    const query = `
        UPDATE anchor_keywords
        SET keyword = $1, type = $2
        WHERE id = $3
        RETURNING *;
    `;
    const { rows } = await db.query(query, [normalized, type, id]);
    return rows[0] || null;
};

/**
 * Xóa một từ khóa neo.
 * @param {number} id - ID của từ khóa.
 */
const remove = async (id) => {
    await db.query('DELETE FROM anchor_keywords WHERE id = $1', [id]);
};

module.exports = {
    create,
    findAll,
    update,
    remove,
};