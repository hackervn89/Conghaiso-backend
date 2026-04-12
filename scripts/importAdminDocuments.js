require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const xlsx = require('xlsx');
const adminDocumentModel = require('../src/models/adminDocumentModel');

const TARGET_SHEETS = new Set(['Báo cáo', 'Nghị quyết']);

function normalizeText(value = '') {
    return String(value)
        .normalize('NFC')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseDate(value) {
    const text = normalizeText(value);
    if (!text || text.toLowerCase() === 'n/a') return null;
    const [dd, mm, yyyy] = text.split('/');
    if (!dd || !mm || !yyyy) return null;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function buildDocumentUrl(documentCode) {
    return `/api/admin-documents/download/${encodeURIComponent(documentCode)}`;
}

async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function resolveExcelPath() {
    const candidates = [
        process.env.ADMIN_DOCS_EXCEL_PATH,
        path.join(process.cwd(), 'Dac_ta_du_lieu_2025_2030.xlsx'),
        path.join(__dirname, '../Dac_ta_du_lieu_2025_2030.xlsx'),
        path.join(__dirname, '../../data/Dac_ta_du_lieu_2025_2030.xlsx'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        const absolute = path.resolve(candidate);
        if (await pathExists(absolute)) {
            return absolute;
        }
    }

    throw new Error(`Không tìm thấy file Excel metadata. Hãy đặt biến ADMIN_DOCS_EXCEL_PATH hoặc đặt file Dac_ta_du_lieu_2025_2030.xlsx trong backend/data.`);
}

async function resolveDataRoot() {
    const candidates = [
        process.env.ADMIN_DOCS_DATA_ROOT,
        path.join(process.cwd(), '../data/1. LƯU VB DO ĐẢNG UỶ BAN HÀNH NHIỆM KỲ 2025-2030'),
        path.join(__dirname, '../../data/1. LƯU VB DO ĐẢNG UỶ BAN HÀNH NHIỆM KỲ 2025-2030'),
        path.join(process.cwd(), 'data/1. LƯU VB DO ĐẢNG UỶ BAN HÀNH NHIỆM KỲ 2025-2030'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        const absolute = path.resolve(candidate);
        if (await pathExists(absolute)) {
            return absolute;
        }
    }

    throw new Error('Không tìm thấy thư mục dữ liệu gốc. Hãy đặt biến ADMIN_DOCS_DATA_ROOT trỏ đến thư mục chứa PDF.');
}

async function buildFileIndex(rootDir) {
    const index = new Map();

    async function walk(currentDir) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }

            const normalizedName = normalizeText(entry.name);
            const codeMatch = normalizedName.match(/A32\.65-[A-ZĐ]+-[A-Z]+-\d{4}-\d{4}/i);
            if (codeMatch) {
                index.set(codeMatch[0].toUpperCase(), {
                    file_name: entry.name,
                    file_path: fullPath,
                });
            }
        }
    }

    await walk(rootDir);
    return index;
}

async function main() {
    const excelPath = await resolveExcelPath();
    const dataRoot = await resolveDataRoot();

    console.log(`[IMPORT] Excel path: ${excelPath}`);
    console.log(`[IMPORT] Data root: ${dataRoot}`);

    const workbook = xlsx.readFile(excelPath);
    const fileIndex = await buildFileIndex(dataRoot);

    let imported = 0;
    let skipped = 0;

    for (const sheetName of workbook.SheetNames) {
        if (!TARGET_SHEETS.has(sheetName)) continue;

        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet);

        for (const row of rows) {
            const documentCode = normalizeText(row['Mã tài liệu']).toUpperCase();
            if (!documentCode) {
                skipped += 1;
                continue;
            }

            const fileMeta = fileIndex.get(documentCode);
            if (!fileMeta) {
                console.warn(`[SKIP] Không tìm thấy file tương ứng cho ${documentCode}`);
                skipped += 1;
                continue;
            }

            await adminDocumentModel.upsert({
                document_code: documentCode,
                file_name: fileMeta.file_name,
                file_path: fileMeta.file_path,
                file_url: buildDocumentUrl(documentCode),
                symbol: normalizeText(row['Số ký hiệu văn bản']) || null,
                doc_type: normalizeText(row['Tên loại văn bản']) || sheetName,
                issued_date: parseDate(row['Ngày, tháng, năm văn bản']),
                issuer: normalizeText(row['Tên cơ quan ban hành']) || null,
                summary: normalizeText(row['Trích yếu nội dung']) || null,
                abstract: normalizeText(row['Tóm tắt']) || null,
                keywords: normalizeText(row['Từ khóa']) || null,
                ocr_status: 'pending',
                ingest_status: 'pending',
                last_error: null,
            });

            imported += 1;
        }
    }

    console.log(`Imported: ${imported}`);
    console.log(`Skipped: ${skipped}`);
}

main().catch((error) => {
    console.error('Import admin documents failed:', error);
    process.exit(1);
});
