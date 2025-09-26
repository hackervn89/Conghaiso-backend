const db = require('../config/database');
const bcrypt = require('bcryptjs');

// ... (các hàm findByUsername, findById, findUserWithOrgsById giữ nguyên) ...
const findByUsername = async (username) => {
  const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0];
};
const findById = async (id) => {
  const { rows } = await db.query('SELECT user_id, full_name, username, email, position, role FROM users WHERE user_id = $1', [id]);
  return rows[0];
};
const findUserWithOrgsById = async (id) => {
    const userQuery = 'SELECT user_id, full_name, username, email, position, role FROM users WHERE user_id = $1';
    const orgsQuery = 'SELECT org_id FROM user_organizations WHERE user_id = $1';

    const [userResult, orgsResult] = await Promise.all([
        db.query(userQuery, [id]),
        db.query(orgsQuery, [id]),
    ]);

    const user = userResult.rows[0];
    if (!user) {
        return null;
    }

    user.organizationIds = orgsResult.rows.map(r => r.org_id);
    return user;
};
const createUser = async (userData) => {
  const { fullName, username, email, password, position, role, organizationIds } = userData;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const userQuery = `
        INSERT INTO users (full_name, username, email, password_hash, position, role) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING user_id, full_name, username, email, position, role;
    `;
    const userResult = await client.query(userQuery, [fullName, username, email, password_hash, position, role]);
    const newUser = userResult.rows[0];
    if (organizationIds && organizationIds.length > 0) {
        const valuesClauses = organizationIds.map((orgId, index) => `($1, $${index + 2})`).join(', ');
        const orgQuery = `INSERT INTO user_organizations (user_id, org_id) VALUES ${valuesClauses};`;
        await client.query(orgQuery, [newUser.user_id, ...organizationIds]);
    }
    await client.query('COMMIT');
    return newUser;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ================= TỐI ƯU HÓA HÀM findAll =================
const findAll = async ({ page = 1, limit = 20, orgId = null }) => {
    const offset = (page - 1) * limit;
    const queryParams = [];
    let paramIndex = 1;

    // Xây dựng các mệnh đề WHERE và JOIN
    let filterClause = '';
    if (orgId) {
        filterClause = `
            JOIN user_organizations uo ON u.user_id = uo.user_id 
            WHERE uo.org_id = $${paramIndex++}
        `;
        queryParams.push(orgId);
    }
    
    // Sử dụng Window Function để đếm tổng số dòng hiệu quả hơn
    const dataQuery = `
        SELECT 
            u.user_id, u.full_name, u.username, u.email, u.position, u.role,
            COUNT(*) OVER() as total_count
        FROM users u
        ${filterClause}
        ORDER BY u.user_id ASC 
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    queryParams.push(limit, offset);

    const { rows } = await db.query(dataQuery, queryParams);

    // Lấy tổng số từ dòng đầu tiên (nếu có)
    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    
    // Loại bỏ cột total_count khỏi kết quả trả về
    const users = rows.map(user => {
        const { total_count, ...rest } = user;
        return rest;
    });

    return { users, totalCount };
};
// ================= KẾT THÚC TỐI ƯU HÓA =================

const update = async (id, userData) => {
  const { fullName, email, position, role, organizationIds } = userData;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const userQuery = `
        UPDATE users SET full_name = $1, email = $2, position = $3, role = $4, updated_at = CURRENT_TIMESTAMP 
        WHERE user_id = $5 
        RETURNING user_id, full_name, username, email, position, role;
    `;
    const userResult = await client.query(userQuery, [fullName, email, position, role, id]);
    const updatedUser = userResult.rows[0];
    await client.query('DELETE FROM user_organizations WHERE user_id = $1', [id]);
    if (organizationIds && organizationIds.length > 0) {
        const valuesClauses = organizationIds.map((orgId, index) => `($1, $${index + 2})`).join(', ');
        const orgQuery = `INSERT INTO user_organizations (user_id, org_id) VALUES ${valuesClauses};`;
        await client.query(orgQuery, [id, ...organizationIds]);
    }
    await client.query('COMMIT');
    return updatedUser;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
const remove = async (id) => {
  const { rows } = await db.query('DELETE FROM users WHERE user_id = $1 RETURNING username', [id]);
  return rows[0];
};
const getSecretaryScopes = async (userId) => {
  const { rows } = await db.query('SELECT org_id FROM secretary_scopes WHERE user_id = $1', [userId]);
  return rows.map(row => row.org_id);
};
const updatePushToken = async (userId, token) => {
  const { rows } = await db.query(
    'UPDATE users SET push_token = $1 WHERE user_id = $2 RETURNING user_id, push_token',
    [token, userId]
  );
  return rows[0];
};
const findPushTokensByUserIds = async (userIds) => {
    if (!userIds || userIds.length === 0) {
        return [];
    }
    const query = `SELECT push_token FROM users WHERE user_id = ANY($1::int[]) AND push_token IS NOT NULL`;
    const { rows } = await db.query(query, [userIds]);
    return rows.map(row => row.push_token);
};
const findPushTokensByMeetingId = async (meetingId) => {
    const query = `
        SELECT u.push_token 
        FROM users u
        JOIN meeting_attendees ma ON u.user_id = ma.user_id
        WHERE ma.meeting_id = $1 AND u.push_token IS NOT NULL;
    `;
    const { rows } = await db.query(query, [meetingId]);
    return rows.map(row => row.push_token);
};

const findAllGroupedByOrganization = async () => {
    const query = `SELECT build_org_tree_with_users();`;
    const { rows } = await db.query(query);
    return rows[0].build_org_tree_with_users || [];
};

const findColleagues = async (userId) => {
    const query = `
        SELECT DISTINCT u2.user_id, u2.full_name
        FROM user_organizations uo1
        JOIN user_organizations uo2 ON uo1.org_id = uo2.org_id
        JOIN users u2 ON uo2.user_id = u2.user_id
        WHERE uo1.user_id = $1 AND uo2.user_id != $1
        ORDER BY u2.full_name;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
};


module.exports = { 
  findByUsername, 
  findById, 
  createUser, 
  findAll, 
  update, 
  remove,
  getSecretaryScopes,
  findAllGroupedByOrganization,
  updatePushToken,
  findPushTokensByUserIds,
  findUserWithOrgsById,
  findPushTokensByMeetingId,
  findColleagues
};