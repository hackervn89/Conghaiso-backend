const meetingModel = require('../models/meetingModel');
const userModel = require('../models/userModel');
const notificationService = require('../services/notificationService');
const storageService = require('../services/storageService');
const path = require('path');
const qrcode = require('qrcode');
const redis = require('../services/redisService');

const { CustomError } = require('../models/errors');
/**
 * Checks if a user has management permissions for a specific meeting.
 * @param {object} user - The user object from req.user.
 * @param {object} meeting - The full meeting object.
 * @returns {Promise<boolean>} - True if the user has permission, otherwise false.
 */
const canUserManageMeeting = async (user, meeting) => {
    // 1. Admin always has permission.
    if (user.role === 'Admin') {
        return true;
    }
    // 2. The user is the chairperson of the meeting.
    if (user.user_id === meeting.chairperson_id) {
        return true;
    }
    // 3. The user is the secretary of the meeting.
    if (user.user_id === meeting.meeting_secretary_id) {
        return true;
    }
    // 4. If the user is a Secretary, check if the meeting is within their scope.
    if (user.role === 'Secretary') {
        const secretaryScopes = await userModel.getSecretaryScopes(user.user_id);
        if (secretaryScopes.includes(meeting.org_id)) {
            return true;
        }
    }
    // 5. Default to no permission.
    return false;
};

const createMeeting = async (req, res) => {
  const user = req.user;
  if (user.role !== 'Admin' && user.role !== 'Secretary') {
    return res.status(403).json({ message: 'Không có quyền tạo cuộc họp.' });
  }
  try {
    const meetingData = { ...req.body };

    // Tự động đặt thời gian kết thúc nếu không được cung cấp
    if (meetingData.startTime && !meetingData.endTime) {
      const startTime = new Date(meetingData.startTime);
      // Thêm 4 giờ vào thời gian bắt đầu
      startTime.setHours(startTime.getHours() + 4);
      meetingData.endTime = startTime.toISOString();
    }

    const newMeeting = await meetingModel.create(meetingData, user.user_id);
    const { attendeeIds } = meetingData;

    if (attendeeIds && attendeeIds.length > 0) {
        const pushTokens = await userModel.findPushTokensByUserIds(attendeeIds);
        if (pushTokens.length > 0) {
            notificationService.sendPushNotifications(
                pushTokens,
                'Thông báo Lịch họp mới',
                `Bạn đã được mời tham dự cuộc họp: "${newMeeting.title}"`,
                { meetingId: newMeeting.meeting_id }
            );
        }
    }
    res.status(201).json({ message: 'Tạo cuộc họp thành công!', meeting: newMeeting });
  } catch (error) {
    console.error('Lỗi khi tạo cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server khi tạo cuộc họp.' });
  }
};

const getMeetings = async (req, res) => {
  try {
    const meetings = await meetingModel.findForUser(req.user, req.query);
    res.status(200).json(meetings);
  } catch (error) {
    console.error('Lỗi khi lấy danh sách cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách cuộc họp.' });
  }
};

const getMeetingById = async (req, res) => {
  const meetingId = req.params.id;
  const cacheKey = `meeting-details:${meetingId}`;

  try {
    // 1. Check Redis cache first
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log(`Cache HIT for meeting: ${meetingId}`);
      // Data in Redis is a string, so we need to parse it back to JSON
      return res.status(200).json(JSON.parse(cachedData));
    }

    console.log(`Cache MISS for meeting: ${meetingId}`);
    // 2. If miss, go to DB
    const meeting = await meetingModel.findById(meetingId, req.user);
    if (!meeting) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
    }

    // 3. Store in Redis before returning
    const ttl = process.env.CACHE_TTL_MEETING_DETAILS || 300; // 5 minutes default
    // Use 'EX' for expiration in seconds. Data must be a string.
    await redis.set(cacheKey, JSON.stringify(meeting), 'EX', ttl);
    console.log(`Stored meeting ${meetingId} in Redis cache with TTL: ${ttl}s`);

    res.status(200).json(meeting);
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server.' });
  }
};

const updateMeeting = async (req, res) => {
  const user = req.user;
  const meetingId = req.params.id;
  const cacheKey = `meeting-details:${meetingId}`;

  try {
    // Note: We don't use the cached version for updates to ensure we have the latest data for permission checks.
    const meeting = await meetingModel.findById(meetingId, user);
    if (!meeting) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
    }
    
    const hasPermission = await canUserManageMeeting(user, meeting);

    if (!hasPermission) {
      return res.status(403).json({ message: 'Không có quyền sửa cuộc họp này.' });
    }

    const meetingData = { ...req.body };
    // Lấy startTime từ dữ liệu gửi lên hoặc từ dữ liệu cũ trong DB
    const finalStartTime = meetingData.startTime || meeting.start_time;

    // Tự động đặt thời gian kết thúc nếu không được cung cấp
    if (finalStartTime && !meetingData.endTime) {
        const startTime = new Date(finalStartTime);
        startTime.setHours(startTime.getHours() + 4);
        meetingData.endTime = startTime.toISOString();
    }
    const updatedMeeting = await meetingModel.update(meetingId, meetingData, user);

    // Invalidate cache in Redis
    await redis.del(cacheKey);
    console.log(`Cache invalidated in Redis for meeting: ${meetingId}`);

    res.status(200).json({ message: 'Cập nhật cuộc họp thành công!', meeting: updatedMeeting });
  } catch (error) {
    console.error('Lỗi khi cập nhật cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server.' });
  }
};

const deleteMeeting = async (req, res) => {
  const user = req.user;
  const meetingId = req.params.id;
  const cacheKey = `meeting-details:${meetingId}`;

  try {
    const meeting = await meetingModel.findById(meetingId, user);
    if (!meeting) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
    }
    
    const hasPermission = await canUserManageMeeting(user, meeting);
    if (!hasPermission) {
      return res.status(403).json({ message: 'Không có quyền xóa cuộc họp này.' });
    }
    const { deletedMeeting, filesToDelete } = await meetingModel.remove(meetingId);

    // Invalidate cache in Redis
    await redis.del(cacheKey);
    console.log(`Cache invalidated in Redis for meeting: ${meetingId}`);

    // Sau khi xóa trong CSDL, xóa thư mục chứa tệp đính kèm
    if (filesToDelete && filesToDelete.length > 0) {
      const meetingDirectory = path.dirname(filesToDelete[0]);
      console.log(`[Meeting Deletion] Bắt đầu dọn dẹp thư mục và các tệp đính kèm: ${meetingDirectory}`);
      await storageService.deleteDirectory(meetingDirectory);
    }

    res.status(200).json({ message: `Đã xóa thành công cuộc họp: "${deletedMeeting.title}"` });
  } catch (error) {
    console.error('Lỗi khi xóa cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server.' });
  }
};

const searchMeetings = async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(200).json([]);
  }
  try {
    const meetings = await meetingModel.search(q, req.user);
    res.status(200).json(meetings);
  } catch (error) {
    console.error('Lỗi khi tìm kiếm cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server khi tìm kiếm cuộc họp.' });
  }
};


const sendCustomNotification = async (req, res) => {
    const { meetingId } = req.params;
    const { title, body } = req.body;
    const user = req.user;
    if (!title || !body) {
        return res.status(400).json({ message: 'Tiêu đề và nội dung không được để trống.' });
    }
    try {
        const meeting = await meetingModel.findById(meetingId, user);
        if (!meeting) {
            return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
        }
        
        const hasPermission = await canUserManageMeeting(user, meeting);
        if (!hasPermission) {
            return res.status(403).json({ message: 'Bạn không có quyền gửi thông báo cho cuộc họp này.' });
        }
        const pushTokens = await userModel.findPushTokensByMeetingId(meetingId);
        if (pushTokens.length > 0) {
            notificationService.sendPushNotifications(pushTokens, title, body, { meetingId });
        }
        res.status(200).json({ message: `Đã gửi thông báo đến ${pushTokens.length} người tham dự.` });

    } catch (error) {
        console.error(`Lỗi khi gửi thông báo tùy chỉnh cho cuộc họp ${meetingId}:`, error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

const getAttendanceStats = async (req, res) => {
    const { meetingId } = req.params;
    const user = req.user;
    try {
        const meeting = await meetingModel.findById(meetingId, user);
        if (!meeting) {
            return res.status(404).json({ message: 'Không tìm thấy cuộc họp.' });
        }
        const hasPermission = await canUserManageMeeting(user, meeting);
        if (!hasPermission) {
            return res.status(403).json({ message: 'Không có quyền xem thống kê điểm danh.' });
        }
        const stats = await meetingModel.getAttendanceStats(meetingId);
        res.status(200).json(stats);
    } catch (error) {
        console.error('Lỗi khi lấy thống kê điểm danh:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê điểm danh.' });
    }
};

const updateAttendance = async (req, res) => {
    const { meetingId } = req.params;
    const { userId, status } = req.body;
    const user = req.user;
    const cacheKey = `meeting-details:${meetingId}`;

    try {
        const meeting = await meetingModel.findById(meetingId, user);
        if (!meeting) return res.status(404).json({ message: 'Không tìm thấy cuộc họp.' });
        
        const hasPermission = await canUserManageMeeting(user, meeting);
        if (!hasPermission) {
            return res.status(403).json({ message: 'Không có quyền điểm danh.' });
        }
        
        // 1. Cập nhật vào database
        await meetingModel.updateSingleAttendance(meetingId, userId, status);

        // 2. Vô hiệu hóa cache
        await redis.del(cacheKey);
        console.log(`Cache INVALIDATED in Redis for meeting after manual attendance update: ${meetingId}`);

        // 3. [CẢI TIẾN] Lấy lại toàn bộ dữ liệu mới nhất của cuộc họp
        // Dùng user của người thực hiện hành động để đảm bảo quyền truy cập
        const updatedMeetingData = await meetingModel.findById(meetingId, user);

        // 4. [CẢI TIẾN] Cache lại dữ liệu mới này
        if (updatedMeetingData) {
            const ttl = process.env.CACHE_TTL_MEETING_DETAILS || 300;
            await redis.set(cacheKey, JSON.stringify(updatedMeetingData), 'EX', ttl);
            console.log(`Cache REFRESHED in Redis for meeting ${meetingId}`);
        }

        // 5. [CẢI TIẾN] Phát sự kiện với toàn bộ danh sách người tham dự đã được cập nhật
        const roomName = `meeting-room-${meetingId}`;
        req.io.to(roomName).emit('attendance_list_updated', updatedMeetingData.attendees);

        res.status(200).json({ message: "Cập nhật điểm danh thành công." });
    } catch (error) {
        console.error("Lỗi khi cập nhật điểm danh:", error);
        res.status(500).json({ message: 'Lỗi khi cập nhật điểm danh.' });
    }
};

const getQrCodeToken = async (req, res) => {
    const { meetingId } = req.params;
    const user = req.user;
    try {
        const meeting = await meetingModel.findById(meetingId, user);
        if (!meeting) return res.status(404).json({ message: 'Không tìm thấy cuộc họp.' });
        
        const hasPermission = await canUserManageMeeting(user, meeting);
        if (!hasPermission) {
            return res.status(403).json({ message: 'Không có quyền tạo mã QR.' });
        }
        
        const qrToken = await meetingModel.findOrCreateQrToken(meetingId);
        const qrData = JSON.stringify({ meetingId: parseInt(meetingId), token: qrToken });
        const qrCodeImage = await qrcode.toDataURL(qrData);

        res.status(200).json({ qrCodeImage });
    } catch (error) {
        console.error('Lỗi khi tạo mã QR:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo mã QR.' });
    }
};

const checkInWithQr = async (req, res) => {
    const { meetingId } = req.params;
    const { token: qrToken } = req.body;
    const user = req.user;
    const cacheKey = `meeting-details:${meetingId}`;
    
    // [LOG] Bắt đầu luồng xử lý
    console.log(`[QR Check-in START] User ID: ${user.user_id} đang điểm danh cho Meeting ID: ${meetingId} với token: ${qrToken}`);

    try {
        // 1. Cập nhật vào CSDL.
        console.log(`[QR Check-in DB-UPDATE] Bắt đầu cập nhật CSDL...`);
        const attendeeCheckedIn = await meetingModel.checkInWithQr(meetingId, qrToken, user.user_id);
        console.log(`[QR Check-in DB-OK] CSDL đã cập nhật thành công cho User ID: ${user.user_id}.`);

        // 2. Vô hiệu hóa cache.
        console.log(`[QR Check-in CACHE-INVALIDATE] Bắt đầu vô hiệu hóa cache cho key: ${cacheKey}`);
        await redis.del(cacheKey);
        console.log(`[QR Check-in CACHE-OK] Cache đã được vô hiệu hóa thành công.`);

        // 3. [CẢI TIẾN] Lấy lại toàn bộ dữ liệu mới nhất của cuộc họp.
        // Dùng user của người điểm danh để đảm bảo quyền truy cập.
        console.log(`[QR Check-in DB-FETCH] Bắt đầu lấy lại dữ liệu mới nhất của cuộc họp từ CSDL...`);
        const updatedMeetingData = await meetingModel.findById(meetingId, user);
        console.log(`[QR Check-in DB-FETCH-OK] Đã lấy dữ liệu mới thành công. Số người tham dự: ${updatedMeetingData?.attendees?.length || 'không có'}`);

        // 4. [CẢI TIẾN] Cache lại dữ liệu mới này ngay lập tức.
        if (updatedMeetingData) {
            const ttl = process.env.CACHE_TTL_MEETING_DETAILS || 300;
            console.log(`[QR Check-in CACHE-REFRESH] Bắt đầu làm mới cache cho key: ${cacheKey} với TTL: ${ttl}s`);
            await redis.set(cacheKey, JSON.stringify(updatedMeetingData), 'EX', ttl);
            console.log(`[QR Check-in CACHE-REFRESH-OK] Cache đã được làm mới thành công.`);
        }
        
        // 5. [CẢI TIẾN] Phát sự kiện real-time với toàn bộ danh sách người tham dự đã được cập nhật.
        const roomName = `meeting-room-${meetingId}`;
        const updatePayload = updatedMeetingData ? updatedMeetingData.attendees : [];
        
        // [LOG] Ghi lại hành động phát tín hiệu cho frontend
        console.log(`[QR Check-in SOCKET-EMIT] Chuẩn bị phát sự kiện 'attendance_list_updated' tới phòng '${roomName}'...`);
        req.io.to(roomName).emit('attendance_list_updated', updatePayload);
        console.log(`[QR Check-in SOCKET-OK] Đã phát thành công sự kiện tới tất cả client trong phòng.`);

        // 6. Gửi phản hồi thành công về cho client đã thực hiện điểm danh
        console.log(`[QR Check-in DONE] Hoàn tất xử lý. Gửi phản hồi 200 OK.`);
        res.status(200).json({ message: 'Điểm danh thành công!' });

    } catch (error) {
        // Phân biệt lỗi nghiệp vụ (CustomError) và lỗi hệ thống
        if (error instanceof CustomError) {
            // Đây là lỗi nghiệp vụ đã được dự đoán (ví dụ: QR sai, đã điểm danh)
            console.warn(`[QR Check-in] Lỗi nghiệp vụ cho meeting ${meetingId}: ${error.message}`);
            // [LOG] Thêm log khi gửi phản hồi lỗi nghiệp vụ
            console.log(`[QR Check-in FAIL] Gửi phản hồi lỗi ${error.statusCode} cho client.`);
            return res.status(error.statusCode).json({ message: error.message });
        }
        // Đây là lỗi hệ thống không mong muốn (ví dụ: mất kết nối DB)
        console.error(`[QR Check-in ERROR] Lỗi hệ thống khi điểm danh cho meeting ${meetingId}:`, error);
        console.log(`[QR Check-in FAIL] Gửi phản hồi lỗi 500 cho client.`);
        res.status(500).json({ message: 'Lỗi server khi điểm danh.' });
    }
};
// --- CHỨC NĂNG MỚI: ỦY QUYỀN THAM DỰ ---
const getDelegationCandidates = async (req, res) => {
    try {
        const { meetingId } = req.params;
        const delegatorUserId = req.user.user_id; // Lấy từ middleware xác thực

        const managedOrgIds = await meetingModel.getManagedOrgIds(delegatorUserId);
        
        if (managedOrgIds.length === 0) {
            return res.json([]); // Nếu không quản lý đơn vị nào, trả về mảng rỗng
        }

        const candidates = await meetingModel.getDelegationCandidates(managedOrgIds, delegatorUserId);
        res.json(candidates);
    } catch (error) {
        console.error('Error fetching delegation candidates:', error);
        res.status(500).json({ message: 'Lỗi máy chủ khi lấy danh sách ủy quyền.' });
    }
};

const delegateAttendance = async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { delegateToUserId } = req.body;
        const delegatorUserId = req.user.user_id;
        const cacheKey = `meeting-details:${meetingId}`;

        if (!delegateToUserId) {
            return res.status(400).json({ message: 'Vui lòng chọn người được ủy quyền.' });
        }
        
        const result = await meetingModel.createDelegation(meetingId, delegatorUserId, delegateToUserId);

        // Vô hiệu hóa cache cho cuộc họp này để đảm bảo frontend nhận được dữ liệu mới nhất
        await redis.del(cacheKey);
        console.log(`Cache invalidated in Redis for meeting after delegation: ${meetingId}`);

        res.status(200).json({ message: 'Ủy quyền thành công!', data: result });
    } catch (error) {
        if (error instanceof CustomError) {
            // Lỗi nghiệp vụ đã được dự đoán
            console.warn(`[Delegation] Lỗi nghiệp vụ cho meeting ${meetingId}: ${error.message}`);
            return res.status(error.statusCode).json({ message: error.message });
        }
        // Lỗi hệ thống không mong muốn
        console.error(`[Delegation] Lỗi hệ thống khi ủy quyền cho meeting ${meetingId}:`, error);
        res.status(500).json({ message: 'Lỗi máy chủ khi thực hiện ủy quyền.' });
    }
};
module.exports = { 
    createMeeting,
    getMeetings, 
    getMeetingById, 
    updateMeeting,
    deleteMeeting,
    searchMeetings,     
    sendCustomNotification,
    getAttendanceStats,
    updateAttendance,
    getQrCodeToken,
    checkInWithQr,
    getDelegationCandidates,
    delegateAttendance
};
