const draftModel = require('../models/draftModel');
const storageService = require('../services/storageService');
const notificationService = require('../services/notificationService');
const userModel = require('../models/userModel');

const createDraft = async (req, res) => {
    try {
        const creatorId = req.user.user_id;
        const { title, document_number, participants, deadline } = req.body;
        const document = req.file;

        if (!title || !participants || !document) {
            return res.status(400).json({ message: 'Tiêu đề, người tham gia và tài liệu là bắt buộc.' });
        }

        // 1. Decode file name
        const decodedName = Buffer.from(document.originalname, 'latin1').toString('utf8');
        const decodedFile = { ...document, originalname: decodedName };

        // 2. Save file to permanent storage
        const filePath = await storageService.moveFileToDraftFolder(decodedFile);

        // 3. Parse participants
        let participantIds = [];
        try {
            participantIds = JSON.parse(participants);
            if (!Array.isArray(participantIds)) throw new Error();
        } catch (e) {
            return res.status(400).json({ message: '`participants` phải là một chuỗi JSON của một mảng các user_id.' });
        }

        // 4. Create draft in DB
        const draftData = { title, document_number, participants: participantIds, deadline };
        const fileInfo = { fileName: decodedName, filePath };

        const newDraft = await draftModel.create(draftData, fileInfo, creatorId);

        // 5. Gửi thông báo
        if (participantIds.length > 0) {
            // Gọi service thông báo ngay tại controller
            notificationService.sendNotification(
                participantIds,
                {
                    title: 'Thư mời góp ý dự thảo',
                    body: `Bạn được mời góp ý cho dự thảo: "${newDraft.title}"`,
                    data: { type: 'new_draft', draftId: newDraft.id }
                }
            );
        }

        res.status(201).json({ message: 'Tạo luồng góp ý thành công!', draft: newDraft });
    } catch (error) {
        console.error('Lỗi khi tạo luồng góp ý:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo luồng góp ý.' });
    }
};

const getDrafts = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const drafts = await draftModel.findAllForUser(userId);
        res.status(200).json(drafts);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách dự thảo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách dự thảo.' });
    }
};

const getDraftById = async (req, res) => {
    try {
        const draftId = req.params.id;
        const userId = req.user.user_id;
        const userRole = req.user.role;

        const draft = await draftModel.findById(draftId, userId);

        if (!draft) {
            return res.status(404).json({ message: 'Không tìm thấy dự thảo hoặc bạn không có quyền truy cập.' });
        }

        // Check permission to view comments
        const canViewComments = userRole === 'Admin' || userRole === 'Secretary' || draft.creator_id === userId;

        if (canViewComments) {
            draft.comments = await draftModel.findCommentsByDraftId(draftId);
        } else {
            draft.comments = [];
        }

        res.status(200).json(draft);
    } catch (error) {
        console.error('Lỗi khi lấy chi tiết dự thảo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết dự thảo.' });
    }
};

const addComment = async (req, res) => {
    try {
        const draftId = req.params.id;
        const userId = req.user.user_id;
        const { comment } = req.body;

        if (!comment) {
            return res.status(400).json({ message: 'Nội dung góp ý không được để trống.' });
        }

        const participant = await draftModel.findParticipant(draftId, userId);
        if (!participant) {
            return res.status(403).json({ message: 'Bạn không phải là người tham gia của dự thảo này.' });
        }
        if (participant.status !== 'cho_y_kien') {
            return res.status(400).json({ message: 'Bạn đã gửi ý kiến cho dự thảo này rồi.' });
        }

        await draftModel.addComment(draftId, userId, comment);

        res.status(200).json({ message: 'Gửi góp ý thành công.' });
    } catch (error) {
        console.error('Lỗi khi gửi góp ý:', error);
        res.status(500).json({ message: 'Lỗi server khi gửi góp ý.' });
    }
};

const agreeToDraft = async (req, res) => {
    try {
        const draftId = req.params.id;
        const userId = req.user.user_id;

        const participant = await draftModel.findParticipant(draftId, userId);
        if (!participant) {
            return res.status(403).json({ message: 'Bạn không phải là người tham gia của dự thảo này.' });
        }
        if (participant.status !== 'cho_y_kien') {
            return res.status(400).json({ message: 'Bạn đã gửi ý kiến cho dự thảo này rồi.' });
        }

        await draftModel.agree(draftId, userId);

        res.status(200).json({ message: 'Xác nhận thống nhất thành công.' });
    } catch (error) {
        console.error('Lỗi khi xác nhận thống nhất:', error);
        res.status(500).json({ message: 'Lỗi server khi xác nhận thống nhất.' });
    }
};


module.exports = {
    createDraft,
    getDrafts,
    getDraftById,
    addComment,
    agreeToDraft,
};