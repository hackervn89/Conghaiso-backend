const db = require('../config/database');
const googleDriveService = require('../services/googleDriveService');
const findById = async (id, user) => {
  const query = `
    WITH meeting_details AS (
      SELECT
        m.*,
        (
          SELECT json_agg(
            json_build_object(
              'user_id', u.user_id,
              'full_name', u.full_name,
              'status', ma.status,
              'check_in_time', ma.check_in_time
            ) ORDER BY u.full_name ASC
          )
          FROM meeting_attendees ma
          JOIN users u ON ma.user_id = u.user_id
          WHERE ma.meeting_id = m.meeting_id
        ) AS attendees,
        (
          SELECT json_agg(
            json_build_object(
              'agenda_id', a.agenda_id,
              'title', a.title,
              'display_order', a.display_order,
              'documents', (
                SELECT COALESCE(json_agg(
                  json_build_object(
                    'doc_id', d.doc_id,
                    'doc_name', d.doc_name,
                    'google_drive_file_id', d.google_drive_file_id
                  ) ORDER BY d.doc_id
                ), '[]'::json)
                FROM documents d
                WHERE d.agenda_id = a.agenda_id
              )
            ) ORDER BY a.display_order
          )
          FROM agendas a
          WHERE a.meeting_id = m.meeting_id
        ) AS agenda
      FROM meetings m
      WHERE m.meeting_id = $1
    )
    SELECT * FROM meeting_details;
  `;

  const { rows } = await db.query(query, [id]);
  const meeting = rows[0];

  if (!meeting) {
    return null;
  }

  // Ensure attendees and agenda are never null
  meeting.attendees = meeting.attendees || [];
  meeting.agenda = meeting.agenda || [];

  // Authorization check
  if (user.role === 'Admin') {
    return meeting;
  }

  const isAttendee = meeting.attendees.some(attendee => attendee && attendee.user_id === user.user_id);
  if (isAttendee) {
    return meeting;
  }

  if (user.role === 'Secretary') {
    const scopeQuery = 'SELECT 1 FROM secretary_scopes WHERE user_id = $1 AND org_id = $2';
    const scopeResult = await db.query(scopeQuery, [user.user_id, meeting.org_id]);
    if (scopeResult.rows.length > 0) {
      return meeting;
    }
  }

  return null;
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

/**
 * [MỚI] Lấy số liệu thống kê điểm danh cho một cuộc họp.
 * @param {number} meetingId - ID của cuộc họp
 * @returns {Promise<object>} - Đối tượng chứa các số liệu thống kê
 */
const getAttendanceStats = async (meetingId) => {
    const query = `
        SELECT
            -- Đếm tổng số người được mời (không phải Admin/Văn thư hệ thống)
            COUNT(*) AS total_summoned,
            
            -- Đếm số người có mặt
            COUNT(*) FILTER (WHERE ma.status = 'present') AS total_present,
            
            -- Đếm số người vắng không phép
            COUNT(*) FILTER (WHERE ma.status = 'absent') AS total_absent,
            
            -- Đếm số người vắng có phép
            COUNT(*) FILTER (WHERE ma.status = 'absent_with_reason') AS total_absent_with_reason
        FROM meeting_attendees ma
        JOIN users u ON ma.user_id = u.user_id
        WHERE ma.meeting_id = $1
          AND u.role NOT IN ('Admin', 'Secretary'); -- Loại trừ vai trò hệ thống
    `;
    const { rows } = await db.query(query, [meetingId]);
    // Chuyển đổi các giá trị count (là string) sang number
    const stats = {
        totalSummoned: parseInt(rows[0].total_summoned, 10),
        totalPresent: parseInt(rows[0].total_present, 10),
        totalAbsent: parseInt(rows[0].total_absent, 10),
        totalAbsentWithReason: parseInt(rows[0].total_absent_with_reason, 10),
    };
    return stats;
};


// ... (các hàm khác không thay đổi) ...
const findForUser = async (user) => {
  const userId = user.user_id;
  if (user.role === 'Admin') {
    const query = 'SELECT * FROM meetings ORDER BY start_time DESC';
    const { rows } = await db.query(query);
    return rows;
  }
  if (user.role === 'Secretary') {
    const query = `
      SELECT * FROM meetings
      WHERE org_id IN (SELECT org_id FROM secretary_scopes WHERE user_id = $1)
      UNION
      SELECT m.* FROM meetings m
      JOIN meeting_attendees ma ON m.meeting_id = ma.meeting_id
      WHERE ma.user_id = $1
      ORDER BY start_time DESC;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  }
  const query = `
    SELECT m.*
    FROM meetings m
    JOIN meeting_attendees ma ON m.meeting_id = ma.meeting_id
    WHERE ma.user_id = $1
    ORDER BY start_time DESC;
  `;
  const { rows } = await db.query(query, [userId]);
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
    ORDER BY m.start_time DESC;
  `;
  const { rows } = await db.query(query, [userId, searchTerm]);
  return rows;
};

const remove = async (id) => {
  const { rows: meetingToDelete } = await db.query('SELECT * FROM meetings WHERE meeting_id = $1', [id]);
  const meetingInfo = meetingToDelete[0];
  const { rows } = await db.query('DELETE FROM meetings WHERE meeting_id = $1 RETURNING *;', [id]);
  const deletedMeeting = rows[0];
  if (deletedMeeting && meetingInfo.google_drive_folder_id) {
    googleDriveService.deleteFileOrFolder(meetingInfo.google_drive_folder_id);
  }
  return deletedMeeting;
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
    
    const date = new Date(startTime);
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const meetingFolderName = `${newMeeting.meeting_id} - ${title}`;
    const yearFolderId = await googleDriveService.findOrCreateFolder(year, googleDriveService.ROOT_FOLDER_ID);
    const monthFolderId = await googleDriveService.findOrCreateFolder(month, yearFolderId);
    const meetingFolderId = await googleDriveService.findOrCreateFolder(meetingFolderName, monthFolderId);
    await client.query('UPDATE meetings SET google_drive_folder_id = $1 WHERE meeting_id = $2', [meetingFolderId, newMeeting.meeting_id]);
    if (attendeeIds && attendeeIds.length > 0) {
      const valuesClauses = attendeeIds.map((_, index) => `($1, $${index + 2}, 'pending')`).join(', ');
      const attendeeQuery = `INSERT INTO meeting_attendees (meeting_id, user_id, status) VALUES ${valuesClauses};`;
      await client.query(attendeeQuery, [newMeeting.meeting_id, ...attendeeIds]);
    }
    const filesToMove = [];
    if (agenda && agenda.length > 0) {
      for (const [index, agendaItem] of agenda.entries()) {
        if (agendaItem.title && agendaItem.title.trim() !== '') {
          const agendaQuery = `INSERT INTO agendas (meeting_id, title, display_order) VALUES ($1, $2, $3) RETURNING agenda_id;`;
          const agendaResult = await client.query(agendaQuery, [newMeeting.meeting_id, agendaItem.title, index + 1]);
          const newAgendaId = agendaResult.rows[0].agenda_id;
          if (agendaItem.documents && agendaItem.documents.length > 0) {
            for (const doc of agendaItem.documents) {
              if (doc.doc_name && doc.doc_name.trim() !== '' && doc.google_drive_file_id) {
                const docQuery = `INSERT INTO documents (agenda_id, doc_name, google_drive_file_id) VALUES ($1, $2, $3);`;
                await client.query(docQuery, [newAgendaId, doc.doc_name, doc.google_drive_file_id]);
                filesToMove.push(doc.google_drive_file_id);
              }
            }
          }
        }
      }
    }
    
    await client.query('COMMIT');
    if (filesToMove.length > 0) {
      filesToMove.forEach(fileId => googleDriveService.moveFile(fileId, meetingFolderId));
    }
    return newMeeting;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const update = async (id, meetingData, user) => {
  const { title, location, startTime, endTime, attendeeIds, agenda, chairperson_id, meeting_secretary_id } = meetingData;
  const { rows: oldMeetingResult } = await db.query('SELECT * FROM meetings WHERE meeting_id = $1', [id]);
  const oldMeeting = oldMeetingResult[0];
  const client = await db.getClient();
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
              if (doc.doc_name && doc.doc_name.trim() !== '' && doc.google_drive_file_id) {
                const docQuery = `INSERT INTO documents (agenda_id, doc_name, google_drive_file_id) VALUES ($1, $2, $3);`;
                await client.query(docQuery, [newAgendaId, doc.doc_name, doc.google_drive_file_id]);
              }
            }
          }
        }
      }
    }
    
    await client.query('COMMIT');
    if (oldMeeting.google_drive_folder_id) {
      const newFolderName = `${id} - ${title}`;
      if (oldMeeting.title !== title) {
         googleDriveService.renameFolder(oldMeeting.google_drive_folder_id, newFolderName);
      }
    }
    const updatedMeeting = await findById(id, user);
    return updatedMeeting;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
            throw new Error('Mã QR không hợp lệ hoặc đã hết hạn.');
        }
        const meeting = meetingResult.rows[0];

        const attendeeResult = await client.query(
            'SELECT status FROM meeting_attendees WHERE meeting_id = $1 AND user_id = $2',
            [meetingId, userId]
        );
        if (attendeeResult.rows.length === 0) {
            throw new Error('Bạn không có trong danh sách tham dự cuộc họp này.');
        }
        if (attendeeResult.rows[0].status === 'present') {
             throw new Error('Bạn đã điểm danh rồi.');
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
  getAttendanceStats, // <-- Export hàm mới
};

