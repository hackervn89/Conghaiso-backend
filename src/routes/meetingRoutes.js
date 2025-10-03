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
  checkInWithQr
} = require('../controllers/meetingController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/search', searchMeetings);
router.post('/:meetingId/notify', sendCustomNotification);

// --- Routes for attendance ---
router.get('/:meetingId/attendance-stats', getAttendanceStats);
router.post('/:meetingId/attendance', updateAttendance);
router.get('/:meetingId/qr-code', getQrCodeToken);
router.post('/:meetingId/check-in', checkInWithQr);

router.route('/')
  .get(getMeetings)
  .post(createMeeting);

router.route('/:id')
  .get(getMeetingById)
  .put(updateMeeting)
  .delete(deleteMeeting);

module.exports = router;

