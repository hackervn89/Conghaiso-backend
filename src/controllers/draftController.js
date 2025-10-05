const draftModel = require('../models/draftModel');
const storageService = require('../services/storageService');
const notificationService = require('../services/notificationService');
const userModel = require('../models/userModel');
const path = require('path');

const createDraft = async (req, res) => {
    try {
        const creatorId = req.user.user_id;
        const { title, document_number, participants, deadline } = req.body; // participants là chuỗi JSON
        const documents = req.files; // Đây là một mảng các file

        if (!title || !participants || !documents || documents.length === 0) {
            return res.status(400).json({ message: 'Tiêu đề, người tham gia và ít nhất một tài liệu là bắt buộc.' });
        }

        // 1. Parse participants
        let participantIds = [];
        try {
            participantIds = JSON.parse(participants);
            if (!Array.isArray(participantIds)) throw new Error();
        } catch (e) {
            // Nếu parse lỗi, không cần làm gì thêm, trả về lỗi ngay
            return res.status(400).json({ message: '`participants` phải là một chuỗi JSON của một mảng các user_id.' });
        }

        // 2. Decode file names
        const decodedFiles = documents.map(file => ({
            ...file,
            originalname: Buffer.from(file.originalname, 'latin1').toString('utf8')
        }));

        // 3. Bắt đầu transaction: Tạo draft -> Lưu file -> Lưu attachment
        const draftData = {
            title,
            document_number,
            participants: participantIds,
            deadline,
            creatorId
        };

        // Hàm create giờ sẽ xử lý transaction
        const newDraft = await draftModel.create(draftData, decodedFiles);

        // 4. Gửi thông báo (sau khi transaction thành công)
        if (participantIds.length > 0) {
            notificationService.sendNotification(
                participantIds,
                {
                    title: 'Thư mời góp ý dự thảo',
                    body: `Bạn được mời góp ý cho dự thảo: "${newDraft.title}"`,
                    data: { type: 'new_draft', draftId: newDraft.draft_id }
                }
            );
        }

        res.status(201).json({ message: 'Tạo luồng góp ý thành công!', draft: newDraft });
    } catch (error) {
        // Lỗi từ model (transaction) hoặc các lỗi khác sẽ được bắt ở đây
        console.error('Lỗi khi tạo luồng góp ý:', error);
        // Xóa các file đã được tạo nếu có lỗi sau khi lưu file
        if (error.savedFiles) {
            error.savedFiles.forEach(filePath => storageService.deleteFile(filePath));
        }
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

const deleteDraft = async (req, res) => {
    try {
        const draftId = req.params.id;
        const userId = req.user.user_id;
        const userRole = req.user.role;

        // Lấy thông tin dự thảo để kiểm tra quyền sở hữu
        const draft = await draftModel.findById(draftId, userId);

        if (!draft) {
            return res.status(404).json({ message: 'Không tìm thấy dự thảo hoặc bạn không có quyền truy cập.' });
        }

        // Chỉ người tạo hoặc Admin mới có quyền xóa
        if (draft.creator_id !== userId && userRole !== 'Admin') {
            return res.status(403).json({ message: 'Bạn không có quyền xóa dự thảo này.' });
        }

        // Xóa trong CSDL và lấy về danh sách tệp cần xóa
        const filesToDelete = await draftModel.remove(draftId);

        // Sau khi CSDL đã xóa thành công, tiến hành xóa file vật lý
        if (filesToDelete && filesToDelete.length > 0) {
            // Lấy đường dẫn thư mục từ tệp đầu tiên và xóa toàn bộ thư mục đó.
            // Hàm deleteDirectory sẽ xóa cả thư mục và tất cả các tệp bên trong.
            const draftDirectory = path.dirname(filesToDelete[0]);
            console.log(`[Draft Deletion] Bắt đầu dọn dẹp thư mục và các tệp đính kèm: ${draftDirectory}`);
            await storageService.deleteDirectory(draftDirectory);
        }

        res.status(200).json({ message: 'Đã xóa luồng góp ý thành công.' });
    } catch (error) {
        console.error('Lỗi khi xóa luồng góp ý:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa luồng góp ý.' });
    }
};

module.exports = {
    createDraft,
    getDrafts,
    getDraftById,
    addComment,
    agreeToDraft,
    deleteDraft,
};