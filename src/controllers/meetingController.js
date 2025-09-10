const meetingModel = require('../models/meetingModel');
const userModel = require('../models/userModel');
const notificationService = require('../services/notificationService');
const googleDriveService = require('../services/googleDriveService');
const qrcode = require('qrcode');

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
    const newMeeting = await meetingModel.create(req.body, user.user_id);
    const { attendeeIds } = req.body;
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
    const meetings = await meetingModel.findForUser(req.user);
    res.status(200).json(meetings);
  } catch (error) {
    console.error('Lỗi khi lấy danh sách cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách cuộc họp.' });
  }
};

const getMeetingById = async (req, res) => {
  try {
    const meeting = await meetingModel.findById(req.params.id, req.user);
    if (!meeting) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
    }
    res.status(200).json(meeting);
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server.' });
  }
};

const updateMeeting = async (req, res) => {
  const user = req.user;
  const meetingId = req.params.id;
  try {
    const meeting = await meetingModel.findById(meetingId, user);
    if (!meeting) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
    }
    
    const hasPermission = await canUserManageMeeting(user, meeting);

    if (!hasPermission) {
      return res.status(403).json({ message: 'Không có quyền sửa cuộc họp này.' });
    }
    const updatedMeeting = await meetingModel.update(meetingId, req.body, user);
    res.status(200).json({ message: 'Cập nhật cuộc họp thành công!', meeting: updatedMeeting });
  } catch (error) {
    console.error('Lỗi khi cập nhật cuộc họp:', error);
    res.status(500).json({ message: 'Lỗi server.' });
  }
};

const deleteMeeting = async (req, res) => {
  const user = req.user;
  const meetingId = req.params.id;
  try {
    const meeting = await meetingModel.findById(meetingId, user);
    if (!meeting) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
    }
    
    const hasPermission = await canUserManageMeeting(user, meeting);
    if (!hasPermission) {
      return res.status(403).json({ message: 'Không có quyền xóa cuộc họp này.' });
    }
    const deletedMeeting = await meetingModel.remove(meetingId);
    res.status(200).json({ message: `Đã xóa thành công cuộc họp: ${deletedMeeting.title}` });
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

const getDocumentViewUrl = async (req, res) => {
  const { meetingId, fileId } = req.params;
  const user = req.user;
  try {
    const meeting = await meetingModel.findById(meetingId, user);
    if (!meeting) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc họp hoặc không có quyền truy cập.' });
    }
    await googleDriveService.makeFilePublic(fileId);
    const fileInfo = await googleDriveService.getFileInfo(fileId);
    const REVOKE_DELAY_MS = 5 * 60 * 1000;
    setTimeout(() => {
      googleDriveService.revokePublicPermission(fileId);
    }, REVOKE_DELAY_MS);
    res.status(200).json({ url: fileInfo.webViewLink });
  } catch (error) {
    console.error('Lỗi khi lấy URL xem tài liệu:', error);
    res.status(500).json({ message: 'Không thể lấy link xem tài liệu.' });
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
    try {
        const meeting = await meetingModel.findById(meetingId, user);
        if (!meeting) return res.status(404).json({ message: 'Không tìm thấy cuộc họp.' });
        
        const hasPermission = await canUserManageMeeting(user, meeting);
        if (!hasPermission) {
            return res.status(403).json({ message: 'Không có quyền điểm danh.' });
        }
        
        const updatedAttendee = await meetingModel.updateSingleAttendance(meetingId, userId, status);
        res.status(200).json(updatedAttendee);
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
    try {
        const result = await meetingModel.checkInWithQr(meetingId, user.user_id, qrToken);
        if (!result) {
            return res.status(400).json({ message: 'Điểm danh thất bại. Mã QR không hợp lệ hoặc bạn không có trong danh sách tham dự.' });
        }
        res.status(200).json({ message: 'Điểm danh thành công!', attendee: result });
    } catch (error) {
        console.error('Lỗi khi điểm danh bằng QR:', error);
        res.status(500).json({ message: 'Lỗi server khi điểm danh.' });
    }
};

module.exports = { 
    createMeeting,
    getMeetings, 
    getMeetingById, 
    updateMeeting,
    deleteMeeting,
    searchMeetings, 
    getDocumentViewUrl,
    sendCustomNotification,
    getAttendanceStats,
    updateAttendance,
    getQrCodeToken,
    checkInWithQr
};

