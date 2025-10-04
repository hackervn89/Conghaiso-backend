const storageService = require('../services/storageService');

const uploadDocument = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một file để tải lên.' });
    }

    // Sửa lỗi mã hóa tên tệp từ latin1 (mặc định của multer) sang utf8
    const decodedFiles = req.files.map(file => {
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      return {
        ...file,
        originalname: decodedName
      };
    });

    // Lưu tệp vào thư mục tạm
    const uploadPromises = decodedFiles.map(file => 
        storageService.saveFileToTempFolder(file)
    );
    const tempFilePaths = await Promise.all(uploadPromises);
    
    // Trả về thông tin tệp tạm thời cho client
    const filesInfo = decodedFiles.map((file, index) => ({
      filePath: tempFilePaths[index], // Sửa thành filePath để nhất quán với frontend đang mong đợi
      name: file.originalname,        // Tên gốc của tệp
    }));

    res.status(201).json({
      message: `Tải lên thành công ${filesInfo.length} file vào thư mục tạm!`,
      files: filesInfo,
    });
  } catch (error) {
    console.error('Lỗi khi tải file lên thư mục tạm:', error);
    res.status(500).json({ message: 'Đã có lỗi xảy ra trên server khi tải tệp lên.' });
  }
};

module.exports = { uploadDocument };