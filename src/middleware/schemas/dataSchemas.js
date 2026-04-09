const Joi = require('joi');

/**
 * Schema validate cho tạo cuộc họp.
 */
const createMeetingSchema = Joi.object({
  title: Joi.string().trim().min(5).max(500).required()
    .label('Tiêu đề cuộc họp'),
  location: Joi.string().trim().max(255).allow('', null)
    .label('Địa điểm'),
  startTime: Joi.date().iso().required()
    .label('Thời gian bắt đầu'),
  endTime: Joi.date().iso().greater(Joi.ref('startTime')).allow(null)
    .label('Thời gian kết thúc'),
  orgId: Joi.number().integer().positive().required()
    .label('Đơn vị tổ chức'),
  attendeeIds: Joi.array().items(Joi.number().integer().positive()).min(1).required()
    .label('Danh sách người tham dự'),
  chairperson_id: Joi.number().integer().positive().allow(null)
    .label('Chủ tọa'),
  meeting_secretary_id: Joi.number().integer().positive().allow(null)
    .label('Thư ký cuộc họp'),
  agenda: Joi.array().items(
    Joi.object({
      title: Joi.string().trim().max(500).allow('', null),
      documents: Joi.array().items(
        Joi.object({
          doc_name: Joi.string().max(255),
          tempPath: Joi.string().max(512).allow(null),
          filePath: Joi.string().max(512).allow(null),
        })
      ).optional()
    })
  ).optional()
    .label('Nội dung cuộc họp'),
});

/**
 * Schema validate cho tạo công việc.
 */
const createTaskSchema = Joi.object({
  title: Joi.string().trim().min(5).max(500).required()
    .label('Tiêu đề công việc'),
  description: Joi.string().trim().max(5000).allow('', null)
    .label('Mô tả'),
  priority: Joi.string().valid('normal', 'important', 'urgent').default('normal')
    .label('Mức độ ưu tiên'),
  dueDate: Joi.date().iso().allow(null)
    .label('Hạn hoàn thành'),
  assignedOrgIds: Joi.array().items(Joi.number().integer().positive()).optional()
    .label('Đơn vị phụ trách'),
  assignedUserIds: Joi.array().items(Joi.number().integer().positive()).optional()
    .label('Người phụ trách'),
  documentRef: Joi.string().max(255).allow('', null)
    .label('Số hiệu văn bản'),
  isDirectAssignment: Joi.boolean().optional(),
});

module.exports = { createMeetingSchema, createTaskSchema };
