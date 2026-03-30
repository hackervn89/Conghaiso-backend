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

      // Task 2: Thay đổi logic xử lý file .doc/.docx
      if (['.doc', '.docx'].includes(fileExt)) {
        // Thay vì convert trực tiếp, ta lưu file gốc và đưa vào hàng đợi
        console.log(`[Upload] Đưa file ${finalFile.originalname} vào hàng đợi chuyển đổi...`);
        const tempPath = await storageService.saveFileToTempFolder(finalFile);
        
        // Thêm vào hàng đợi xử lý (ví dụ với BullMQ)
        // await conversionQueue.add('convert-to-pdf', { 
        //   tempPath, 
        //   originalname: finalFile.originalname,
        //   userId: req.user.user_id // Để gửi thông báo khi hoàn thành
        // });

        processingFiles.push({
          name: finalFile.originalname,
          message: "Đang được xử lý chuyển đổi sang PDF."
        });

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

    // Task 2: Trả về status 202 Accepted nếu có file đang được xử lý
    if (processingFiles.length > 0) {
      return res.status(202).json({
        message: `Đã nhận ${req.files.length} file. ${filesInfo.length} file sẵn sàng, ${processingFiles.length} file đang được xử lý nền.`,
        files: filesInfo, // Các file đã sẵn sàng
        processing: processingFiles // Các file đang xử lý
      });
    }

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