const db = require('../config/database');

const findAll = async () => {
  const { rows } = await db.query('SELECT * FROM organizations ORDER BY display_order ASC NULLS LAST, org_name ASC');
  return rows;
};

// --- HÀM FINDALLHIERARCHICAL ĐÃ ĐƯỢC NÂNG CẤP TOÀN DIỆN ---
const findAllHierarchical = async () => {
    // Sử dụng Truy vấn Đệ quy (Recursive CTE) để xây dựng cây JSON trực tiếp trong PostgreSQL
    const query = `select build_org_tree()`;
    try {
        const { rows } = await db.query(query);
        // Kết quả trả về từ hàm là một đối tượng JSON đã có cấu trúc cây hoàn chỉnh
        return rows[0].build_org_tree || [];
    } catch (error) {
        console.error("Lỗi khi thực thi hàm build_org_tree:", error);
        // Fallback về logic cũ nếu hàm chưa tồn tại
        const { rows } = await db.query('SELECT * FROM organizations ORDER BY display_order ASC NULLS LAST, org_name ASC');
        const map = new Map();
        const roots = [];
        rows.forEach(org => map.set(org.org_id, { ...org, children: [] }));
        rows.forEach(org => {
            if (org.parent_id && map.has(org.parent_id)) {
                map.get(org.parent_id).children.push(map.get(org.org_id));
            } else {
                roots.push(map.get(org.org_id));
            }
        });
        return roots;
    }
};


const create = async ({ name, parentId, display_order }) => {
    const query = 'INSERT INTO organizations (org_name, parent_id, display_order) VALUES ($1, $2, $3) RETURNING *';
    const { rows } = await db.query(query, [name, parentId, display_order]);
    return rows[0];
};

const update = async (id, { name, parentId, display_order }) => {
    const query = 'UPDATE organizations SET org_name = $1, parent_id = $2, display_order = $3 WHERE org_id = $4 RETURNING *';
    const { rows } = await db.query(query, [name, parentId, display_order, id]);
    return rows[0];
};

const remove = async (id) => {
    const { rows } = await db.query('DELETE FROM organizations WHERE org_id = $1 RETURNING *', [id]);
    return rows[0];
};

module.exports = { findAll, findAllHierarchical, create, update, remove };

