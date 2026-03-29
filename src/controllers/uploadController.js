const storageService = require('../services/storageService');
const path = require('path');
const libre = require('libreoffice-convert');
const { promisify } = require('util');
libre.convertAsync = promisify(libre.convert);

const uploadDocument = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một file để tải lên.' });
    }

    const filesInfo = [];
    // Xử lý từng file: giải mã tên, chuyển đổi sang PDF nếu cần
    const processingPromises = req.files.map(async (file) => {
      let finalFile = { ...file };
      // 1. Giải mã tên tệp từ latin1 (mặc định của multer) sang utf8
      finalFile.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const fileExt = path.extname(finalFile.originalname).toLowerCase();

      // 2. Yêu cầu 3: Tự động chuyển đổi Doc/Docx sang PDF
      if (['.doc', '.docx'].includes(fileExt)) {
        try {
          console.log(`[Upload] Bắt đầu chuyển đổi ${finalFile.originalname} sang PDF...`);
          const pdfBuffer = await libre.convertAsync(file.buffer, '.pdf', undefined);
          finalFile.buffer = pdfBuffer;
          const baseName = path.basename(finalFile.originalname, fileExt);
          finalFile.originalname = `${baseName}.pdf`;
          console.log(`[Upload] Chuyển đổi thành công. Tên file mới: ${finalFile.originalname}`);
        } catch (convertErr) {
            console.error(`Lỗi khi chuyển đổi file ${finalFile.originalname} sang PDF:`, convertErr);
            // Ném lỗi để Promise.all bắt được và trả về lỗi 500
            throw new Error(`Không thể chuyển đổi file ${finalFile.originalname} sang PDF.`);
        }
      }
      
      // 3. Lưu tệp (đã được chuyển đổi nếu cần) vào thư mục tạm
      const tempPath = await storageService.saveFileToTempFolder(finalFile);
      filesInfo.push({
        filePath: tempPath,
        name: finalFile.originalname,
      });
    });

    await Promise.all(processingPromises);

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