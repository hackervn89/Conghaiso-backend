const db = require('../config/database');
const bcrypt = require('bcryptjs');
const organizationModel = require('./organizationModel');

// ... (các hàm khác giữ nguyên không thay đổi)
const findByUsername = async (username) => {
  const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0];
};
const findById = async (id) => {
  const { rows } = await db.query('SELECT user_id, full_name, username, email, position, role FROM users WHERE user_id = $1', [id]);
  return rows[0];
};
const findUserWithOrgsById = async (id) => {
    const query = `
        SELECT 
            u.user_id, u.full_name, u.username, u.email, u.position, u.role,
            COALESCE(
                (SELECT json_agg(uo.org_id) FROM user_organizations uo WHERE uo.user_id = u.user_id),
                '[]'::json
            ) as "organizationIds"
        FROM users u
        WHERE u.user_id = $1;
    `;
    const { rows } = await db.query(query, [id]);
    return rows[0];
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
const findAll = async ({ page = 1, limit = 20, orgId = null }) => {
    const offset = (page - 1) * limit;
    let baseQuery = `FROM users u`;
    let countQuery = `SELECT COUNT(*) FROM users u`;
    const queryParams = [];
    let paramIndex = 1;
    if (orgId) {
        const filterClause = ` JOIN user_organizations uo ON u.user_id = uo.user_id WHERE uo.org_id = $${paramIndex}`;
        baseQuery += filterClause;
        countQuery += filterClause;
        queryParams.push(orgId);
        paramIndex++;
    }
    const totalResult = await db.query(countQuery, queryParams);
    const totalCount = parseInt(totalResult.rows[0].count, 10);
    const dataQuery = `
        SELECT u.user_id, u.full_name, u.username, u.email, u.position, u.role 
        ${baseQuery} 
        ORDER BY u.user_id ASC 
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const { rows: users } = await db.query(dataQuery, [...queryParams, limit, offset]);
    return { users, totalCount };
};
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

// --- HÀM ĐÃ ĐƯỢC NÂNG CẤP ĐỂ SỬ DỤNG HÀM SQL ---
const findAllGroupedByOrganization = async () => {
    const query = `SELECT build_org_tree_with_users();`;
    const { rows } = await db.query(query);
    return rows[0].build_org_tree_with_users || [];
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
  findPushTokensByMeetingId
};

