const meetingModel = require('../models/meetingModel');
const taskModel = require('../models/taskModel');
const draftModel = require('../models/draftModel');
const { TaskType } = require('@google/generative-ai');

/**
 * Lấy danh sách cuộc họp dựa trên các bộ lọc.
 * @param {object} user - Đối tượng người dùng để phân quyền.
 * @param {object} params - Các tham số từ AI.
 * @param {string} params.date - Ngày cần tìm (ví dụ: '2024-07-30', 'hôm nay', 'ngày mai').
 * @returns {Promise<string>} - Chuỗi văn bản chứa kết quả đã được định dạng.
 */
async function getMeetings({ user, date }) {
    console.log(`[Tool] Executing getMeetings with params:`, { date });
    const targetDate = new Date();
    if (date && date.toLowerCase() === 'ngày mai') {
        targetDate.setDate(targetDate.getDate() + 1);
    }
    // Có thể thêm logic xử lý các ngày khác ở đây

    const filters = {
        startDate: targetDate.toISOString().split('T')[0],
        endDate: targetDate.toISOString().split('T')[0],
    };

    const result = await meetingModel.findForUser(user, filters);
    const meetings = result.meetings || [];

    if (meetings.length === 0) {
        return "Không có cuộc họp nào được tìm thấy cho ngày được chỉ định.";
    }

    let formattedText = `Kết quả truy vấn cuộc họp cho ngày ${targetDate.toLocaleDateString('vi-VN')}:\n`;
    meetings.forEach(m => {
        const startTime = new Date(m.start_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
        formattedText += `- Tiêu đề: ${m.title}, Thời gian: ${startTime}, Địa điểm: ${m.location}\n`;
    });
    return formattedText;
}

/**
 * Lấy danh sách công việc dựa trên các bộ lọc.
 * @param {object} user - Đối tượng người dùng để phân quyền.
 * @param {object} params - Các tham số từ AI.
 * @param {string} params.status - Trạng thái công việc ('đến hạn', 'trễ hạn', 'hoàn thành').
 * @param {string} params.org_name - Tên phòng ban được giao.
 * @returns {Promise<string>} - Chuỗi văn bản chứa kết quả đã được định dạng.
 */
async function getTasks({ user, status, org_name }) {
    console.log(`[Tool] Executing getTasks with params:`, { status, org_name });
    const filters = {};
    if (status) {
        const statusMap = {
            'đến hạn': 'pending,doing',
            'trễ hạn': 'overdue',
            'hoàn thành': 'completed'
        };
        filters.dynamicStatus = statusMap[status.toLowerCase()] || 'pending,doing,overdue';
    }

    // Cần có logic để lấy orgId từ org_name nếu cần
    // Ví dụ: if (org_name) filters.orgId = await getOrgIdByName(org_name);

    const result = await taskModel.findAll(user, filters);
    const tasks = result.tasks || [];

    if (tasks.length === 0) {
        return "Không có công việc nào được tìm thấy với các tiêu chí được chỉ định.";
    }

    let formattedText = `Kết quả truy vấn công việc:\n`;
    tasks.forEach(t => {
        formattedText += `- Tiêu đề: ${t.title}, Trạng thái: ${t.dynamic_status}, Hạn chót: ${t.due_date ? new Date(t.due_date).toLocaleDateString('vi-VN') : 'N/A'}\n`;
    });
    return formattedText;
}

/**
 * [NEW] Lấy danh sách các dự thảo văn bản đang chờ người dùng hiện tại góp ý.
 * @param {object} user - Đối tượng người dùng để phân quyền.
 * @returns {Promise<string>} - Chuỗi văn bản chứa kết quả đã được định dạng.
 */
async function getDraftsForComment({ user }) {
    console.log(`[Tool] Executing getDraftsForComment for user: ${user.user_id}`);

    // Tận dụng hàm model đã có sẵn
    const allDrafts = await draftModel.findAllForUser(user.user_id);

    // Lọc ra các dự thảo mà người dùng này đang ở trạng thái "chờ ý kiến"
    const draftsToComment = allDrafts.filter(d => d.participant_status === 'cho_y_kien');

    if (draftsToComment.length === 0) {
        return "Hiện tại không có dự thảo văn bản nào đang chờ bạn cho ý kiến.";
    }

    let formattedText = `Kết quả truy vấn các dự thảo đang chờ bạn góp ý:\n`;
    draftsToComment.forEach(d => {
        const deadline = d.deadline ? new Date(d.deadline).toLocaleDateString('vi-VN') : 'Không có';
        formattedText += `- Tiêu đề: ${d.title}, Người tạo: ${d.creator_name}, Hạn góp ý: ${deadline}\n`;
    });
    return formattedText;
}

// Định nghĩa các "công cụ" cho Gemini
const functionDeclarations = [
    {
        name: 'get_meetings',
        description: 'Lấy danh sách các cuộc họp dựa trên ngày. Chỉ dùng khi người dùng hỏi về "cuộc họp" hoặc "lịch họp".',
        parameters: {
            type: 'OBJECT',
            properties: {
                date: {
                    type: 'STRING',
                    description: 'Ngày cần tìm kiếm, ví dụ: "hôm nay", "ngày mai", hoặc một ngày cụ thể theo định dạng YYYY-MM-DD.'
                }
            },
            required: ['date']
        }
    },
    {
        name: 'get_tasks',
        description: 'Lấy danh sách công việc dựa trên trạng thái hoặc phòng ban được giao. Chỉ dùng khi người dùng hỏi về "công việc", "nhiệm vụ", hoặc "task".',
        parameters: {
            type: 'OBJECT',
            properties: {
                status: {
                    type: 'STRING',
                    description: 'Trạng thái của công việc cần tìm, ví dụ: "đến hạn", "trễ hạn", "hoàn thành".'
                },
                org_name: {
                    type: 'STRING',
                    description: 'Tên của phòng ban cụ thể được giao công việc, ví dụ: "Văn phòng Đảng ủy".'
                }
            }
        }
    },
    {
        name: 'get_drafts_for_comment',
        description: 'Lấy danh sách các dự thảo văn bản đang chờ người dùng hiện tại cho ý kiến. Chỉ dùng khi người dùng hỏi về "dự thảo", "góp ý", "văn bản cần cho ý kiến".',
        parameters: {
            type: 'OBJECT',
            properties: {}, // Hàm này không cần tham số đầu vào từ AI
        }
    },
];

const availableTools = { get_meetings: getMeetings, get_tasks: getTasks, get_drafts_for_comment: getDraftsForComment };

module.exports = { functionDeclarations, availableTools };