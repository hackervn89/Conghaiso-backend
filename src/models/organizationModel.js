const pool = require('../config/database');

// Lấy tất cả đơn vị
const getAll = async () => {
    const { rows } = await pool.query('SELECT * FROM organizations ORDER BY display_order ASC NULLS LAST, org_name ASC');
    return rows;
};

// Lấy cây đơn vị
const getTree = async () => {
    const { rows } = await pool.query("SELECT build_org_tree() as tree;");
    return rows[0].tree;
};

// Tìm đơn vị theo ID
const findById = async (id) => {
    const { rows } = await pool.query('SELECT * FROM organizations WHERE org_id = $1', [id]);
    return rows[0];
};

// Tạo đơn vị mới
const create = async ({ org_name, parent_id, display_order }) => {
    const { rows } = await pool.query(
        'INSERT INTO organizations (org_name, parent_id, display_order) VALUES ($1, $2, $3) RETURNING *',
        [org_name, parent_id, display_order]
    );
    return rows[0];
};

// Cập nhật đơn vị
const update = async (id, { org_name, parent_id, display_order }) => {
    const { rows } = await pool.query(
        'UPDATE organizations SET org_name = $1, parent_id = $2, display_order = $3 WHERE org_id = $4 RETURNING *',
        [org_name, parent_id, display_order, id]
    );
    return rows[0];
};

// Xóa đơn vị
const remove = async (id) => {
    await pool.query('DELETE FROM organizations WHERE org_id = $1', [id]);
};

// Lấy người dùng theo đơn vị
const getUsersByOrgId = async (orgId) => {
    const query = `
        SELECT u.user_id, u.full_name, u.position
        FROM users u
        JOIN user_organizations uo ON u.user_id = uo.user_id
        WHERE uo.org_id = $1
        ORDER BY u.full_name;
    `;
    const { rows } = await pool.query(query, [orgId]);
    return rows;
};

// Thêm người dùng vào đơn vị
const addUserToOrg = async (orgId, userId) => {
    const { rows } = await pool.query(
        'INSERT INTO user_organizations (org_id, user_id) VALUES ($1, $2) RETURNING *',
        [orgId, userId]
    );
    return rows[0];
};

// Xóa người dùng khỏi đơn vị
const removeUserFromOrg = async (orgId, userId) => {
    await pool.query('DELETE FROM user_organizations WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
};


// === CÁC HÀM MỚI ĐỂ QUẢN LÝ LÃNH ĐẠO ===

// Lấy danh sách lãnh đạo của một đơn vị
const getLeadersByOrgId = async (orgId) => {
    const query = `
        SELECT u.user_id, u.full_name, u.position, ol.leader_title
        FROM organization_leaders ol
        JOIN users u ON ol.user_id = u.user_id
        WHERE ol.org_id = $1
        ORDER BY u.full_name;
    `;
    const { rows } = await pool.query(query, [orgId]);
    return rows;
};

// Thêm một lãnh đạo cho đơn vị
const addLeaderToOrg = async (orgId, userId, leaderTitle) => {
    const query = `
        INSERT INTO organization_leaders (org_id, user_id, leader_title)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, org_id) DO UPDATE SET leader_title = EXCLUDED.leader_title
        RETURNING *;
    `;
    const { rows } = await pool.query(query, [orgId, userId, leaderTitle]);
    return rows[0];
};

// Xóa một lãnh đạo khỏi đơn vị
const removeLeaderFromOrg = async (orgId, userId) => {
    await pool.query('DELETE FROM organization_leaders WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
};


module.exports = {
    getAll,
    getTree,
    findById,
    create,
    update,
    remove,
    getUsersByOrgId,
    addUserToOrg,
    removeUserFromOrg,
    getLeadersByOrgId,
    addLeaderToOrg,
    removeLeaderFromOrg
};

