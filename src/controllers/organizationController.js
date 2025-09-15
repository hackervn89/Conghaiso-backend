const organizationModel = require('../models/organizationModel');

const getOrganizations = async (req, res) => {
  try {
    const organizations = await organizationModel.findAllHierarchical();
    res.status(200).json(organizations);
  } catch (error) {
    console.error('Lỗi server khi lấy danh sách cơ quan:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách cơ quan.' });
  }
};

const createOrganization = async (req, res) => {
    try {
        const newOrg = await organizationModel.create(req.body);
        res.status(201).json(newOrg);
    } catch (error) {
        console.error('Lỗi server khi tạo cơ quan:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo cơ quan.' });
    }
};

const updateOrganization = async (req, res) => {
    try {
        const updatedOrg = await organizationModel.update(req.params.id, req.body);
        if (!updatedOrg) {
            return res.status(404).json({ message: 'Không tìm thấy cơ quan.' });
        }
        res.status(200).json(updatedOrg);
    } catch (error) {
        console.error('Lỗi server khi cập nhật cơ quan:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật cơ quan.' });
    }
};

// --- HÀM DELETE ĐÃ ĐƯỢC NÂNG CẤP ĐỂ XỬ LÝ LỖI ---
const deleteOrganization = async (req, res) => {
    try {
        const deletedOrg = await organizationModel.remove(req.params.id);
        if (!deletedOrg) {
            return res.status(404).json({ message: 'Không tìm thấy cơ quan.' });
        }
        res.status(200).json({ message: 'Đã xóa cơ quan thành công.' });
    } catch (error) {
        // Kiểm tra mã lỗi của PostgreSQL cho vi phạm khóa ngoại
        if (error.code === '23503') {
            return res.status(400).json({ message: 'Không thể xóa. Vẫn còn người dùng hoặc dữ liệu khác phụ thuộc vào cơ quan/đơn vị này.' });
        }
        console.error('Lỗi khi xóa cơ quan:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa cơ quan.' });
    }
};

module.exports = { getOrganizations, createOrganization, updateOrganization, deleteOrganization };