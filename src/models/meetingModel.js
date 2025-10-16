const db = require('../config/database');
const storageService = require('../services/storageService');
const { CustomError } = require('./errors');

const findById = async (id, user) => {
  // Tối ưu hóa: Logic kiểm tra quyền được đưa trực tiếp vào truy vấn SQL.
  // CSDL sẽ chỉ trả về kết quả nếu người dùng có quyền, tránh lãng phí tài nguyên.
  const query = `
    SELECT
      m.*,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'user_id', u.user_id,
            'full_name', u.full_name,
            'role', u.role,
            'status', ma.status,
            'check_in_time', ma.check_in_time,
            'represented_by_user_id', ma.represented_by_user_id,
            'represented_by_user_name', ru.full_name,
            'is_delegated', ma.is_delegated,
            'is_leader', EXISTS (SELECT 1 FROM organization_leaders ol WHERE ol.user_id = u.user_id)
          )), '[]'::json)
        FROM meeting_attendees ma
        LEFT JOIN users ru ON ma.represented_by_user_id = ru.user_id
        JOIN users u ON ma.user_id = u.user_id
        WHERE ma.meeting_id = m.meeting_id
          AND u.role != 'Admin' -- Loại trừ Admin khỏi danh sách hiển thị
      ) AS attendees,
      (
        SELECT json_agg(ag)
        FROM (
          SELECT
            a.agenda_id, a.title, a.display_order,
            (
              SELECT json_agg(json_build_object(
                'doc_id', d.doc_id,
                'doc_name', d.doc_name,
                'filePath', d.file_path
              ))
              FROM documents d
              WHERE d.agenda_id = a.agenda_id
            ) AS documents
          FROM agendas a
          WHERE a.meeting_id = m.meeting_id
          ORDER BY a.display_order
        ) ag
      ) AS agenda
    FROM meetings m
    WHERE m.meeting_id = $1
      AND (
        -- 1. Admin có thể xem mọi thứ
        $3 = 'Admin'
        -- 2. Người dùng là người tham dự (hoặc được mời)
        OR EXISTS (
          SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.meeting_id AND ma.user_id = $2
        )
        -- 3. Người dùng là thư ký và cuộc họp thuộc phạm vi của họ
        OR ($3 = 'Secretary' AND EXISTS (
          SELECT 1 FROM secretary_scopes ss WHERE ss.user_id = $2 AND ss.org_id = m.org_id
        ))
      );
  `;

  const { rows } = await db.query(query, [id, user.user_id, user.role]);
  const meeting = rows[0];

  // Nếu không có dòng nào trả về, nghĩa là không tìm thấy hoặc không có quyền
  return meeting || null;
};

const create = async (meetingData, creatorId) => {
  const { title, location, startTime, endTime, orgId, attendeeIds, agenda, chairperson_id, meeting_secretary_id } = meetingData;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const meetingQuery = `
      INSERT INTO meetings (title, location, start_time, end_time, creator_id, org_id, chairperson_id, meeting_secretary_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const meetingResult = await client.query(meetingQuery, [title, location, startTime, endTime, creatorId, orgId, chairperson_id, meeting_secretary_id]);
    const newMeeting = meetingResult.rows[0];

    if (attendeeIds && attendeeIds.length > 0) {
      const valuesClauses = attendeeIds.map((_, index) => `($1, $${index + 2}, 'pending')`).join(', ');
      const attendeeQuery = `INSERT INTO meeting_attendees (meeting_id, user_id, status) VALUES ${valuesClauses};`;
      await client.query(attendeeQuery, [newMeeting.meeting_id, ...attendeeIds]);
    }

    if (agenda && agenda.length > 0) {
      for (const [index, agendaItem] of agenda.entries()) {
        if (agendaItem.title && agendaItem.title.trim() !== '') {
          const agendaQuery = `INSERT INTO agendas (meeting_id, title, display_order) VALUES ($1, $2, $3) RETURNING agenda_id;`;
          const agendaResult = await client.query(agendaQuery, [newMeeting.meeting_id, agendaItem.title, index + 1]);
          const newAgendaId = agendaResult.rows[0].agenda_id;

          if (agendaItem.documents && agendaItem.documents.length > 0) {
            for (const doc of agendaItem.documents) {
              // Check for tempPath, which indicates a new file to be moved.
              if (doc.tempPath) {
                const finalRelativePath = await storageService.moveFileToMeetingFolder(
                  doc.tempPath,
                  newMeeting.meeting_id,
                  newMeeting.start_time
                );
                
                const docQuery = `INSERT INTO documents (agenda_id, doc_name, file_path) VALUES ($1, $2, $3);`;
                await client.query(docQuery, [newAgendaId, doc.doc_name, finalRelativePath]);
              }
              // This part handles documents that might already have a path (e.g. when copying a meeting, not implemented yet but good to have)
              else if (doc.filePath) {
                 const docQuery = `INSERT INTO documents (agenda_id, doc_name, file_path) VALUES ($1, $2, $3);`;
                 await client.query(docQuery, [newAgendaId, doc.doc_name, doc.filePath]);
              }
            }
          }
        }
      }
    }
    
    await client.query('COMMIT');
    // We need to return the full meeting with the new file paths
    const fullMeeting = await findById(newMeeting.meeting_id, { user_id: creatorId, role: 'Admin' }); // Assume creator has admin rights to view
    return fullMeeting;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const update = async (id, meetingData, user) => {
  const { title, location, startTime, endTime, attendeeIds, agenda, chairperson_id, meeting_secretary_id } = meetingData;
  const client = await db.getClient();
  let docsToDelete = [];

  try {
    await client.query('BEGIN');
    const meetingQuery = `
      UPDATE meetings
      SET title = $1, location = $2, start_time = $3, end_time = $4, 
          chairperson_id = $5, meeting_secretary_id = $6, updated_at = CURRENT_TIMESTAMP
      WHERE meeting_id = $7;
    `;
    await client.query(meetingQuery, [title, location, startTime, endTime, chairperson_id, meeting_secretary_id, id]);
    
    const oldAttendeesResult = await client.query('SELECT user_id FROM meeting_attendees WHERE meeting_id = $1', [id]);
    const oldAttendeeIds = new Set(oldAttendeesResult.rows.map(a => a.user_id));
    const newAttendeeIds = attendeeIds.filter(id => !oldAttendeeIds.has(id));

    if (newAttendeeIds.length > 0) {
      const valuesClauses = newAttendeeIds.map((_, index) => `($1, $${index + 2}, 'pending')`).join(', ');
      const attendeeQuery = `INSERT INTO meeting_attendees (meeting_id, user_id, status) VALUES ${valuesClauses};`;
      await client.query(attendeeQuery, [id, ...newAttendeeIds]);
    }

    const oldAgendasResult = await client.query('SELECT agenda_id FROM agendas WHERE meeting_id = $1', [id]);
    const oldAgendaIds = oldAgendasResult.rows.map(a => a.agenda_id);
    if (oldAgendaIds.length > 0) {
      const docsToDeleteQuery = `SELECT file_path FROM documents WHERE agenda_id = ANY($1::int[]) AND file_path IS NOT NULL`;
      const { rows } = await client.query(docsToDeleteQuery, [oldAgendaIds]);
      docsToDelete = rows;
      await client.query('DELETE FROM documents WHERE agenda_id = ANY($1::int[])', [oldAgendaIds]);
    }
    await client.query('DELETE FROM agendas WHERE meeting_id = $1', [id]);

    if (agenda && agenda.length > 0) {
      for (const [index, agendaItem] of agenda.entries()) {
        if (agendaItem.title && agendaItem.title.trim() !== '') {
          const agendaQuery = `INSERT INTO agendas (meeting_id, title, display_order) VALUES ($1, $2, $3) RETURNING agenda_id;`;
          const agendaResult = await client.query(agendaQuery, [id, agendaItem.title, index + 1]);
          const newAgendaId = agendaResult.rows[0].agenda_id;
          if (agendaItem.documents && agendaItem.documents.length > 0) {
            for (const doc of agendaItem.documents) {
              if (doc.name && doc.name.trim() !== '' && doc.filePath) {
                const docQuery = `INSERT INTO documents (agenda_id, doc_name, file_path) VALUES ($1, $2, $3);`;
                await client.query(docQuery, [newAgendaId, doc.name, doc.filePath]);
              }
            }
          }
        }
      }
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (docsToDelete.length > 0) {
    console.log(`[Storage] Deleting ${docsToDelete.length} old files for updated meeting ${id}...`);
    const deletePromises = docsToDelete.map(doc => storageService.deleteFile(doc.file_path));
    await Promise.all(deletePromises).catch(err => console.error("[Storage] Error during old file cleanup:", err));
  }

  const updatedMeeting = await findById(id, user);
  return updatedMeeting;
};

const remove = async (id) => {
  const docsQuery = `
    SELECT d.file_path 
    FROM documents d
    JOIN agendas a ON d.agenda_id = a.agenda_id
    WHERE a.meeting_id = $1 AND d.file_path IS NOT NULL;
  `;
  const { rows: documentsToDelete } = await db.query(docsQuery, [id]);
  const filePathsToDelete = documentsToDelete.map(doc => doc.file_path);

  const { rows } = await db.query('DELETE FROM meetings WHERE meeting_id = $1 RETURNING *;', [id]);
  const deletedMeeting = rows[0];

  // Trả về cả thông tin cuộc họp đã xóa và danh sách tệp để controller xử lý
  return {
    deletedMeeting,
    filesToDelete: filePathsToDelete
  };
};

// --- Other functions remain unchanged ---

const findForUser = async (user, filters = {}) => {
  const userId = user.user_id;
  const { status, timeRange } = filters;

  let baseQuery = `
    SELECT 
      m.*,
      CASE
        WHEN m.start_time > CURRENT_TIMESTAMP THEN 'upcoming'
        WHEN m.end_time < CURRENT_TIMESTAMP THEN 'finished'
        ELSE 'ongoing'
      END AS dynamic_status
    FROM meetings m
  `;
  const joins = new Set();
  const whereClauses = [];
  const params = [];
  let paramIndex = 1;

  if (user.role === 'Admin') {
    // Admin sees all, no initial WHERE clause based on user
  } else if (user.role === 'Secretary') {
    whereClauses.push(`(
      m.org_id IN (SELECT org_id FROM secretary_scopes WHERE user_id = $${paramIndex})
      OR m.meeting_id IN (SELECT meeting_id FROM meeting_attendees WHERE user_id = $${paramIndex})
    )`);
    params.push(userId);
    paramIndex++;
  } else {
    joins.add('JOIN meeting_attendees ma ON m.meeting_id = ma.meeting_id');
    whereClauses.push(`ma.user_id = $${paramIndex}`);
    params.push(userId);
    paramIndex++;
  }

  // Apply status filter
  if (status) {
    const now = 'CURRENT_TIMESTAMP';
    if (status === 'upcoming') {
      whereClauses.push(`m.start_time > ${now}`);
    } else if (status === 'ongoing') {
      whereClauses.push(`m.start_time <= ${now} AND m.end_time >= ${now}`);
    } else if (status === 'finished') {
      whereClauses.push(`m.end_time < ${now}`);
    }
  }

  // Apply time range filter
  if (timeRange === 'today') {
    whereClauses.push(`m.start_time::date = CURRENT_DATE`);
  } else if (timeRange === 'this_week') {
    whereClauses.push(`date_trunc('week', m.start_time) = date_trunc('week', CURRENT_DATE)`);
  } else if (timeRange === 'this_month') {
    whereClauses.push(`date_trunc('month', m.start_time) = date_trunc('month', CURRENT_DATE)`);
  }

  let finalQuery = `${baseQuery} ${[...joins].join(' ')}`;
  if (whereClauses.length > 0) {
    finalQuery += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  finalQuery += ' ORDER BY m.start_time DESC';

  const { rows } = await db.query(finalQuery, params);
  return rows;
};

const search = async (term, user) => {
  const userId = user.user_id;
  const searchTerm = `%${term}%`;
  if (user.role === 'Admin') {
    const query = 'SELECT * FROM meetings WHERE title ILIKE $1 ORDER BY start_time DESC';
    const { rows } = await db.query(query, [searchTerm]);
    return rows;
  }
  if (user.role === 'Secretary') {
    const query = `
      SELECT * FROM meetings m
      WHERE 
        m.title ILIKE $1
        AND (
          m.org_id IN (SELECT org_id FROM secretary_scopes WHERE user_id = $2)
          OR 
          m.meeting_id IN (SELECT meeting_id FROM meeting_attendees WHERE user_id = $2)
        )
      ORDER BY m.start_time DESC;
    `;
    const { rows } = await db.query(query, [searchTerm, userId]);
    return rows;
  }
  const query = `
    SELECT m.* FROM meetings m
    JOIN meeting_attendees ma ON m.meeting_id = ma.meeting_id
    WHERE ma.user_id = $1 AND m.title ILIKE $2
    ORDER BY start_time DESC;
  `;
  const { rows } = await db.query(query, [userId, searchTerm]);
  return rows;
};

const updateSingleAttendance = async (meetingId, userId, status) => {
    const query = `
        UPDATE meeting_attendees
        SET 
            status = $1::attendance_status,
            check_in_time = CASE WHEN $1 = 'present' THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE meeting_id = $2 AND user_id = $3
        RETURNING *;
    `;
    const { rows } = await db.query(query, [status, meetingId, userId]);
    return rows[0];
};

const getAttendanceStats = async (meetingId) => {
    const query = `
        SELECT
            COUNT(*) FILTER (WHERE ma.status != 'delegated') AS total_summoned,
            COUNT(*) FILTER (WHERE ma.status = 'present') AS total_present,
            COUNT(*) FILTER (WHERE ma.status = 'absent') AS total_absent,
            COUNT(*) FILTER (WHERE ma.status = 'absent_with_reason') AS total_absent_with_reason
        FROM meeting_attendees ma
        JOIN users u ON ma.user_id = u.user_id
        WHERE ma.meeting_id = $1
          AND u.role NOT IN ('Admin', 'Secretary');
    `;
    const { rows } = await db.query(query, [meetingId]);
    const stats = {
        totalSummoned: parseInt(rows[0].total_summoned, 10),
        totalPresent: parseInt(rows[0].total_present, 10),
        totalAbsent: parseInt(rows[0].total_absent, 10),
        totalAbsentWithReason: parseInt(rows[0].total_absent_with_reason, 10),
    };
    return stats;
};

const findOrCreateQrToken = async (meetingId) => {
    let { rows } = await db.query('SELECT qr_code_token FROM meetings WHERE meeting_id = $1', [meetingId]);
    if (rows[0] && rows[0].qr_code_token) {
        return rows[0].qr_code_token;
    }
    const crypto = require('crypto');
    const token = crypto.randomBytes(16).toString('hex');
    ({ rows } = await db.query(
        'UPDATE meetings SET qr_code_token = $1 WHERE meeting_id = $2 RETURNING qr_code_token',
        [token, meetingId]
    ));
    return rows[0].qr_code_token;
};

const checkInWithQr = async (meetingId, token, userId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const meetingResult = await client.query(
            'SELECT title FROM meetings WHERE meeting_id = $1 AND qr_code_token = $2',
            [meetingId, token]
        );
        if (meetingResult.rows.length === 0) {
            throw new CustomError('Mã QR không hợp lệ hoặc đã hết hạn.', 400);
        }
        const meeting = meetingResult.rows[0];

        const attendeeResult = await client.query(
            'SELECT status FROM meeting_attendees WHERE meeting_id = $1 AND user_id = $2',
            [meetingId, userId]
        );
        if (attendeeResult.rows.length === 0) {
            throw new CustomError('Bạn không có trong danh sách tham dự cuộc họp này.', 403);
        }
        if (attendeeResult.rows[0].status === 'present') {
             throw new CustomError('Bạn đã điểm danh rồi.', 409);
        }

        await client.query(
            `UPDATE meeting_attendees
             SET status = 'present', check_in_time = CURRENT_TIMESTAMP
             WHERE meeting_id = $1 AND user_id = $2`,
            [meetingId, userId]
        );
        
        await client.query('COMMIT');
        return meeting;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
// Lấy danh sách các đơn vị mà một user là lãnh đạo
const getManagedOrgIds = async (userId) => {
    const query = 'SELECT org_id FROM organization_leaders WHERE user_id = $1';
    const { rows } = await db.query(query, [userId]);
    return rows.map(row => row.org_id);
};

// Lấy danh sách thành viên từ các đơn vị được quản lý (để ủy quyền)
const getDelegationCandidates = async (managedOrgIds, delegatorUserId) => {
    if (managedOrgIds.length === 0) {
        return [];
    }
    const query = `
        SELECT DISTINCT u.user_id, u.full_name, u.position
        FROM users u
        JOIN user_organizations uo ON u.user_id = uo.user_id
        WHERE uo.org_id = ANY($1::int[]) AND u.user_id != $2;
    `;
    const { rows } = await db.query(query, [managedOrgIds, delegatorUserId]);
    return rows;
};

// Thực hiện ủy quyền tham dự
const createDelegation = async (meetingId, delegatorUserId, delegateToUserId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Cập nhật trạng thái của người ủy quyền (Lãnh đạo)
        const updateDelegatorQuery = `
            UPDATE meeting_attendees
            SET status = 'delegated', represented_by_user_id = $1
            WHERE meeting_id = $2 AND user_id = $3
            RETURNING *;
        `;
        const delegatorResult = await client.query(updateDelegatorQuery, [delegateToUserId, meetingId, delegatorUserId]);
        if (delegatorResult.rows.length === 0) {
            // Người ủy quyền không có trong danh sách mời ban đầu, không thể ủy quyền
            throw new CustomError('Bạn không phải là người tham dự cuộc họp này để có thể ủy quyền.', 403);
        }

        // 2. Thêm người được ủy quyền vào danh sách tham dự (nếu họ chưa có)
        // Hoặc cập nhật nếu họ đã được mời từ trước với vai trò khác
        // Đánh dấu is_delegated = true để biết đây là người được ủy quyền
        const upsertDelegateQuery = `
            INSERT INTO meeting_attendees (meeting_id, user_id, status, is_delegated)
            VALUES ($1, $2, 'pending', true)
            ON CONFLICT (meeting_id, user_id) 
            DO UPDATE SET status = 'pending', is_delegated = true;
        `;
        await client.query(upsertDelegateQuery, [meetingId, delegateToUserId]);

        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { 
  findForUser, 
  create, 
  findById, 
  update, 
  remove, 
  search,
  updateSingleAttendance,
  findOrCreateQrToken,
  checkInWithQr,
  getAttendanceStats,
  getManagedOrgIds,
  getDelegationCandidates,
  createDelegation
};