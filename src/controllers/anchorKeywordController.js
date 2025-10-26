const anchorKeywordModel = require('../models/anchorKeywordModel');
const { loadKeywordsToCache } = require('../config/keywordCache');

const createKeyword = async (req, res) => {
    try {
        const newKeyword = await anchorKeywordModel.create(req.body);
        await loadKeywordsToCache(); // Nạp lại cache sau khi tạo
        res.status(201).json(newKeyword);
    } catch (error) {
        if (error.code === '23505') { // Lỗi unique constraint
            return res.status(409).json({ message: `Từ khóa "${req.body.keyword}" đã tồn tại.` });
        }
        console.error('Lỗi khi tạo từ khóa neo:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo từ khóa.' });
    }
};

const getAllKeywords = async (req, res) => {
    try {
        const { page, limit, searchTerm } = req.query;
        const result = await anchorKeywordModel.findAll({
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 15,
            searchTerm: searchTerm || ''
        });
        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách từ khóa neo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách từ khóa.' });
    }
};

const updateKeyword = async (req, res) => {
    try {
        const { id } = req.params;
        const updatedKeyword = await anchorKeywordModel.update(id, req.body);
        if (!updatedKeyword) {
            return res.status(404).json({ message: 'Không tìm thấy từ khóa.' });
        }
        await loadKeywordsToCache(); // Nạp lại cache sau khi cập nhật
        res.status(200).json(updatedKeyword);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ message: `Từ khóa "${req.body.keyword}" đã tồn tại.` });
        }
        console.error('Lỗi khi cập nhật từ khóa neo:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật từ khóa.' });
    }
};

const deleteKeyword = async (req, res) => {
    try {
        const { id } = req.params;
        await anchorKeywordModel.remove(id);
        await loadKeywordsToCache(); // Nạp lại cache sau khi xóa
        res.status(200).json({ message: 'Đã xóa từ khóa thành công.' });
    } catch (error) {
        console.error('Lỗi khi xóa từ khóa neo:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa từ khóa.' });
    }
};

module.exports = { createKeyword, getAllKeywords, updateKeyword, deleteKeyword };