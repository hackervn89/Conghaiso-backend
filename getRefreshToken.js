const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Đường dẫn chính xác đến file credentials
const KEYFILEPATH = path.join(__dirname, 'src/config/oauth_credentials.json');
const SCOPES = 'https://www.googleapis.com/auth/drive'

async function main() {
  const keys = JSON.parse(fs.readFileSync(KEYFILEPATH));
  const client = new google.auth.OAuth2(
    keys.installed.client_id,
    keys.installed.client_secret,
    keys.installed.redirect_uris[0]
  );

  const authorizeUrl = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('--- BƯỚC 1: LẤY URL CẤP PHÉP ---');
  console.log('Hãy copy URL sau, dán vào trình duyệt và cấp quyền:');
  console.log(authorizeUrl);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question('\n--- BƯỚC 2: NHẬP MÃ CODE ---\nSau khi cấp quyền, hãy copy chuỗi ký tự sau "code=" trong URL trang lỗi và dán vào đây:\n> ', async (code) => {
    try {
      console.log('\nĐang lấy Refresh Token...');
      const { tokens } = await client.getToken(code);
      console.log('\n--- THÀNH CÔNG! ---');
      console.log('Đây là Refresh Token của bạn. Hãy sao chép và lưu nó vào file .env:');
      console.log(tokens.refresh_token);
    } catch (e) {
      console.error('Lỗi khi lấy token:', e.message);
    } finally {
      rl.close();
    }
  });
}

main().catch(console.error);