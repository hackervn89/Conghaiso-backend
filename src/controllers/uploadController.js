const storageService = require('../services/storageService');
const path = require('path');
const libre = require('libreoffice-convert');
const { promisify } = require('util');
libre.convertAsync = promisify(libre.convert);

// Task 2: Tách tác vụ Convert PDF ra khỏi luồng Request chính
// Giả định rằng bạn đã cài đặt BullMQ và có một file cấu hình queue
// const { conversionQueue } = require('../queues/conversionQueue'); 
// Worker sẽ xử lý queue này và bắn socket event khi hoàn thành.

const uploadDocument = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một file để tải lên.' });
    }

    const filesInfo = [];
    const processingFiles = []; // Dành cho các file cần xử lý nền

    // Xử lý từng file: giải mã tên, chuyển đổi sang PDF nếu cần
    const processingPromises = req.files.map(async (file) => {
      let finalFile = { ...file };
      // 1. Giải mã tên tệp từ latin1 (mặc định của multer) sang utf8
      finalFile.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const fileExt = path.extname(finalFile.originalname).toLowerCase();

      // Chuyển đổi trực tiếp đối với file .doc/.docx
      if (['.doc', '.docx'].includes(fileExt)) {
        console.log(`[Upload] Đang tiến hành chuyển đổi file ${finalFile.originalname} sang PDF...`);
        try {
          const pdfBuffer = await libre.convertAsync(finalFile.buffer, '.pdf', undefined);
          
          const pdfFile = {
             ...finalFile,
             originalname: finalFile.originalname.replace(new RegExp(`${fileExt}$`, 'i'), '.pdf'),
             buffer: pdfBuffer,
             mimetype: 'application/pdf'
          };
          
          const tempPath = await storageService.saveFileToTempFolder(pdfFile);
          
          filesInfo.push({
            filePath: tempPath,
            name: pdfFile.originalname,
            originalName: finalFile.originalname,
          });
          
          console.log(`[Upload] Chuyển đổi thành công: ${pdfFile.originalname}`);
        } catch (convertError) {
           console.error(`[Upload] Lỗi khi chuyển đổi ${finalFile.originalname} sang PDF:`, convertError);
           throw new Error(`Lỗi chuyển đổi file ${finalFile.originalname} (Yêu cầu LibreOffice trên Server).`);
        }
      } else {
        // Các loại file khác (PDF, TXT, ảnh,...) được lưu trực tiếp
        const tempPath = await storageService.saveFileToTempFolder(finalFile);
        filesInfo.push({
          filePath: tempPath,
          name: finalFile.originalname,
        });
      }
    });

    await Promise.all(processingPromises);

    res.status(201).json({
      message: `Tải lên thành công ${filesInfo.length} file vào thư mục tạm.`,
      files: filesInfo,
    });
  } catch (error) {
    console.error('Lỗi khi tải file lên thư mục tạm:', error);
    res.status(500).json({ message: 'Đã có lỗi xảy ra trên server khi tải tệp lên.' });
  }
};

module.exports = { uploadDocument };