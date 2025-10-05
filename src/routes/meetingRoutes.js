const express = require('express');
const { 
    getMeetings, 
    createMeeting, 
    getMeetingById, 
    updateMeeting, 
    deleteMeeting,
    searchMeetings,
    sendCustomNotification,
    getAttendanceStats,
    updateAttendance,
    getQrCodeToken,
    checkInWithQr,
    // Thêm 2 hàm mới từ controller
    getDelegationCandidates,
    delegateAttendance,
} = require('../controllers/meetingController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// Áp dụng middleware xác thực cho tất cả các route bên dưới
router.use(authenticate);

// --- Routes for searching and notifications ---
router.get('/search', searchMeetings);
router.post('/:meetingId/notify', sendCustomNotification);

// --- Routes for attendance ---
router.get('/:meetingId/attendance-stats', getAttendanceStats);
router.post('/:meetingId/attendance', updateAttendance);
router.get('/:meetingId/qr-code', getQrCodeToken);
router.post('/:meetingId/check-in', checkInWithQr);

// --- Routes for Delegation (Chức năng mới) ---
// Lấy danh sách người có thể được ủy quyền
router.get('/:meetingId/delegation-candidates', getDelegationCandidates);

// Thực hiện hành động ủy quyền
router.post('/:meetingId/attendees/me/delegate', delegateAttendance);


// --- Routes for core meeting CRUD ---
router.route('/')
    .get(getMeetings)
    .post(createMeeting);

router.route('/:id')
    .get(getMeetingById)
    .put(updateMeeting)
    .delete(deleteMeeting);

module.exports = router;
