const userModel = require('../models/userModel');

const getAllUsers = async (req, res) => {
  try {
    const { page, limit, orgId } = req.query;
    const options = {
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 20,
        orgId: orgId ? parseInt(orgId, 10) : null,
    };
    const result = await userModel.findAll(options);
    res.status(200).json(result);
  } catch (error) {
    console.error('Lỗi server khi lấy danh sách người dùng:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách người dùng.' });
  }
};

const createUserByAdmin = async (req, res) => {
  try {
    const newUser = await userModel.createUser(req.body);
    res.status(201).json({ message: 'Tạo người dùng thành công!', user: newUser });
  } catch (error) {
    if (error.code === '23505') {
        return res.status(400).json({ message: `Lỗi: ${error.constraint} đã tồn tại.` });
    }
    console.error('Lỗi server khi tạo người dùng:', error);
    res.status(500).json({ message: 'Lỗi server khi tạo người dùng.' });
  }
};
const getUserDetails = async (req, res) => {
    try {
        const user = await userModel.findUserWithOrgsById(req.params.id);
        if (user) {
            res.status(200).json(user);
        } else {
            res.status(404).json({ message: 'Không tìm thấy người dùng.' });
        }
    } catch (error) {
        console.error('Lỗi server khi lấy chi tiết người dùng:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết người dùng.' });
    }
};
const updateUser = async (req, res) => {
  try {
    const updatedUser = await userModel.update(req.params.id, req.body);
    if (!updatedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }
    res.status(200).json({ message: 'Cập nhật người dùng thành công!', user: updatedUser });
  } catch (error)
 {
    console.error('Lỗi server khi cập nhật người dùng:', error);
    res.status(500).json({ message: 'Lỗi server khi cập nhật người dùng.' });
  }
};
const deleteUser = async (req, res) => {
  try {
    const deletedUser = await userModel.remove(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }
    res.status(200).json({ message: `Đã xóa thành công người dùng: ${deletedUser.username}` });
  } catch (error) {
    console.error('Lỗi server khi xóa người dùng:', error);
    res.status(500).json({ message: 'Lỗi server khi xóa người dùng.' });
  }
};
const getUsersGrouped = async (req, res) => {
  try {
    const groupedUsers = await userModel.findAllGroupedByOrganization();
    res.status(200).json(groupedUsers);
  } catch (error) {
    console.error('Lỗi server khi lấy danh sách người dùng theo nhóm:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách người dùng theo nhóm.' });
  }
};

const getColleagues = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const colleagues = await userModel.findColleagues(userId);
        res.status(200).json(colleagues);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách đồng nghiệp:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách đồng nghiệp.' });
    }
};


const savePushToken = async (req, res) => {
  const userId = req.user.user_id;
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ message: 'Không tìm thấy push token trong yêu cầu.' });
  }
  try {
    await userModel.updatePushToken(userId, token);
    res.status(200).json({ message: 'Đã lưu Push Token thành công.' });
  } catch (error) {
    console.error('Lỗi khi lưu Push Token:', error);
    res.status(500).json({ message: 'Lỗi server khi lưu Push Token.' });
  }
};

module.exports = {
  createUserByAdmin,
  getAllUsers,
  getUserDetails,
  updateUser,
  deleteUser,
  getUsersGrouped,
  getColleagues,
  savePushToken,
};

