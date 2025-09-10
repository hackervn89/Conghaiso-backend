const bcrypt = require('bcryptjs');
const readline = require('readline');

// Tạo một giao diện để đọc dữ liệu từ terminal
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Đặt câu hỏi cho người dùng
rl.question('Nhập mật khẩu bạn muốn băm: ', async (password) => {
  if (!password) {
    console.log('Lỗi: Bạn chưa nhập mật khẩu.');
    rl.close();
    return;
  }

  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    console.log('\n--- THÔNG TIN ---');
    console.log('Mật khẩu gốc    :', password);
    console.log('Chuỗi hash        :', hashedPassword);
    console.log('\n=> Sử dụng chuỗi hash này để cập nhật hoặc tạo người dùng mới trong CSDL.');

  } catch (error) {
    console.error('Đã xảy ra lỗi khi băm mật khẩu:', error);
  } finally {
    // Đóng giao diện readline để kết thúc chương trình
    rl.close();
  }
});