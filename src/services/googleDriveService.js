const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const stream = require('stream');

const KEYFILEPATH = path.join(process.cwd(), process.env.GOOGLE_OAUTH_CREDENTIALS_PATH);
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const REFRESH_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

const keys = JSON.parse(fs.readFileSync(KEYFILEPATH));

const oAuth2Client = new google.auth.OAuth2(
  keys.installed.client_id,
  keys.installed.client_secret,
  keys.installed.redirect_uris[0]
);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oAuth2Client });

const findOrCreateFolder = async (name, parentId) => {
  const query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
  const { data: { files } } = await drive.files.list({ q: query, fields: 'files(id, name)', supportsAllDrives: true });
  if (files.length > 0) {
    return files[0].id;
  } else {
    const { data } = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    });
    return data.id;
  }
};

const uploadFile = async (fileObject, parentFolderId) => {
  const bufferStream = new stream.PassThrough();
  bufferStream.end(fileObject.buffer);
  const { data } = await drive.files.create({
    media: { mimeType: fileObject.mimeType, body: bufferStream },
    requestBody: { name: fileObject.originalname, parents: [parentFolderId || ROOT_FOLDER_ID] },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return data;
};

const deleteFileOrFolder = async (fileId) => {
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (error) {
    if (error.code !== 404) console.error(`Lỗi khi xóa file/thư mục ${fileId}:`, error.message);
  }
};

const renameFolder = async (folderId, newName) => {
  try {
    await drive.files.update({ fileId: folderId, requestBody: { name: newName }, supportsAllDrives: true });
  } catch (error) {
    console.error(`Lỗi khi đổi tên thư mục ${folderId}:`, error.message);
  }
};

const moveFile = async (fileId, targetFolderId) => {
  try {
    const file = await drive.files.get({
      fileId: fileId,
      fields: 'parents',
      supportsAllDrives: true,
    });
    const previousParents = file.data.parents.join(',');
    await drive.files.update({
      fileId: fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      fields: 'id, parents',
      supportsAllDrives: true,
    });
  } catch (error) {
    console.error(`Lỗi khi di chuyển file ${fileId}:`, error.message);
  }
};

const getFileInfo = async (fileId) => {
  const { data } = await drive.files.get({
    fileId: fileId,
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return data;
};

const makeFilePublic = async (fileId) => {
  try {
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
      supportsAllDrives: true,
    });
  } catch (error) {
    if (error.code !== 403) {
      console.error(`Lỗi khi cấp quyền công khai cho file ${fileId}:`, error.message);
      throw error;
    }
  }
};

// --- HÀM MỚI: THU HỒI QUYỀN XEM CÔNG KHAI ---
const revokePublicPermission = async (fileId) => {
  try {
    // 1. Lấy danh sách các quyền của file
    const { data: { permissions } } = await drive.permissions.list({
      fileId: fileId,
      fields: 'permissions(id, type, role)',
      supportsAllDrives: true,
    });

    // 2. Tìm ID của quyền công khai ('anyone' with 'reader' role)
    const publicPermission = permissions.find(p => p.type === 'anyone' && p.role === 'reader');

    // 3. Nếu tìm thấy, xóa quyền đó đi
    if (publicPermission) {
      await drive.permissions.delete({
        fileId: fileId,
        permissionId: publicPermission.id,
        supportsAllDrives: true,
      });
      console.log(`[LOG] Đã thu hồi thành công quyền công khai cho file ${fileId}.`);
    }
  } catch (error) {
    console.error(`Lỗi khi thu hồi quyền cho file ${fileId}:`, error.message);
    // Không ném lỗi ra ngoài để không làm sập các tiến trình khác
  }
};


module.exports = { uploadFile, findOrCreateFolder, deleteFileOrFolder, renameFolder, moveFile, ROOT_FOLDER_ID, getFileInfo, makeFilePublic, revokePublicPermission };