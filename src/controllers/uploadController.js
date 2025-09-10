const googleDriveService = require('../services/googleDriveService');

const uploadDocument = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một file để tải lên.' });
    }

    // SỬA LỖI TRIỆT ĐỂ: Chuyển đổi mã hóa tên file từ latin1 (mặc định của multer) sang utf8
    const decodedFiles = req.files.map(file => {
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      return {
        ...file,
        originalname: decodedName
      };
    });

    // Sử dụng mảng file đã được giải mã tên để tải lên
    const uploadPromises = decodedFiles.map(file => googleDriveService.uploadFile(file));
    const uploadedFiles = await Promise.all(uploadPromises);
    
    const filesInfo = uploadedFiles.map(file => ({
      id: file.id,
      name: file.name, // Tên file trả về từ Google Drive giờ đã đúng chuẩn UTF-8
    }));

    res.status(201).json({
      message: `Tải lên thành công ${filesInfo.length} file!`,
      files: filesInfo,
    });
  } catch (error) {
    console.error('Lỗi khi tải file lên:', error);
    res.status(500).json({ message: 'Đã có lỗi xảy ra trên server.' });
  }
};

module.exports = { uploadDocument };

