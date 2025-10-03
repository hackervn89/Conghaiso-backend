const storageService = require('../services/storageService');

const uploadDocument = async (req, res) => {
  try {
    const { entityId } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một file để tải lên.' });
    }

    // entityId là bắt buộc để đặt tệp vào đúng thư mục.
    if (!entityId) {
        return res.status(400).json({ message: 'Yêu cầu phải có entityId (ví dụ: meetingId, taskId).' });
    }

    // Sửa lỗi mã hóa tên tệp từ latin1 (mặc định của multer) sang utf8
    const decodedFiles = req.files.map(file => {
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      return {
        ...file,
        originalname: decodedName
      };
    });

    // Sử dụng storageService mới để lưu tệp cục bộ
    const uploadPromises = decodedFiles.map(file => 
        storageService.saveFileToEntityFolder(file, entityId)
    );
    const savedFilePaths = await Promise.all(uploadPromises);
    
    // Thông tin trả về cho client
    const filesInfo = decodedFiles.map((file, index) => ({
      filePath: savedFilePaths[index], // Đường dẫn tương đối trên server
      name: file.originalname,       // Tên gốc của tệp
    }));

    res.status(201).json({
      message: `Tải lên thành công ${filesInfo.length} file!`,
      files: filesInfo,
    });
  } catch (error) {
    console.error('Lỗi khi tải file lên:', error);
    res.status(500).json({ message: 'Đã có lỗi xảy ra trên server khi tải tệp lên.' });
  }
};

module.exports = { uploadDocument };

