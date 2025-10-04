const organizationModel = require('../models/organizationModel');

exports.getAllOrgs = async (req, res) => {
    try {
        const orgs = await organizationModel.getAll();
        res.json(orgs);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi lấy danh sách đơn vị', error: error.message });
    }
};

exports.getOrgTree = async (req, res) => {
    try {
        const tree = await organizationModel.getTree();
        res.json(tree);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi lấy cây đơn vị', error: error.message });
    }
};

exports.getOrgById = async (req, res) => {
    try {
        const org = await organizationModel.findById(req.params.id);
        if (org) {
            res.json(org);
        } else {
            res.status(404).json({ message: 'Không tìm thấy đơn vị' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi lấy thông tin đơn vị', error: error.message });
    }
};

exports.createOrg = async (req, res) => {
    try {
        const newOrg = await organizationModel.create(req.body);
        res.status(201).json(newOrg);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi tạo đơn vị mới', error: error.message });
    }
};

exports.updateOrg = async (req, res) => {
    try {
        const updatedOrg = await organizationModel.update(req.params.id, req.body);
        res.json(updatedOrg);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi cập nhật đơn vị', error: error.message });
    }
};

exports.deleteOrg = async (req, res) => {
    try {
        await organizationModel.remove(req.params.id);
        res.status(200).json({ message: 'Đã xóa đơn vị thành công' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi xóa đơn vị', error: error.message });
    }
};

exports.getUsersByOrg = async (req, res) => {
    try {
        const users = await organizationModel.getUsersByOrgId(req.params.orgId);
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi lấy danh sách người dùng của đơn vị', error: error.message });
    }
};

exports.addUserToOrg = async (req, res) => {
    try {
        const { userId } = req.body;
        const result = await organizationModel.addUserToOrg(req.params.orgId, userId);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi thêm người dùng vào đơn vị', error: error.message });
    }
};

exports.removeUserFromOrg = async (req, res) => {
    try {
        await organizationModel.removeUserFromOrg(req.params.orgId, req.params.userId);
        res.status(200).json({ message: 'Đã xóa người dùng khỏi đơn vị' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi xóa người dùng khỏi đơn vị', error: error.message });
    }
};

// === CÁC HÀM ĐỂ QUẢN LÝ LÃNH ĐẠO ===

exports.getOrgLeaders = async (req, res) => {
    try {
        const leaders = await organizationModel.getLeadersByOrgId(req.params.orgId);
        res.json(leaders);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi lấy danh sách lãnh đạo.', error: error.message });
    }
};

exports.addOrgLeader = async (req, res) => {
    const { userId, leaderTitle } = req.body;
    const { orgId } = req.params;
    try {
        const newLeader = await organizationModel.addLeaderToOrg(orgId, userId, leaderTitle);
        res.status(201).json(newLeader);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi thêm lãnh đạo.', error: error.message });
    }
};

exports.removeOrgLeader = async (req, res) => {
    const { orgId, userId } = req.params;
    try {
        await organizationModel.removeLeaderFromOrg(orgId, userId);
        res.status(200).json({ message: 'Đã xóa vai trò lãnh đạo thành công.' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi xóa lãnh đạo.', error: error.message });
    }
};

