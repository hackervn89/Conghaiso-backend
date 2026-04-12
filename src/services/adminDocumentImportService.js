const fs = require('fs/promises');
const path = require('path');
const xlsx = require('xlsx');
const adminDocumentModel = require('../models/adminDocumentModel');

const DEFAULT_TARGET_SHEETS = ['Báo cáo', 'Nghị quyết'];

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
        path.join(__dirname, '../../Dac_ta_du_lieu_2025_2030.xlsx'),
        path.join(__dirname, '../../../data/Dac_ta_du_lieu_2025_2030.xlsx'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        const absolute = path.resolve(candidate);
        if (await pathExists(absolute)) {
            return absolute;
        }
    }

    throw new Error('EXCEL_FILE_NOT_FOUND');
}

async function resolveDataRoot(customDataRoot = null) {
    const candidates = [
        customDataRoot,
        process.env.ADMIN_DOCS_DATA_ROOT,
        path.join(process.cwd(), '../data/tai_lieu'),
        path.join(__dirname, '../../../data/tai_lieu'),
        path.join(process.cwd(), '../data/1. LƯU VB DO ĐẢNG UỶ BAN HÀNH NHIỆM KỲ 2025-2030'),
        path.join(__dirname, '../../../data/1. LƯU VB DO ĐẢNG UỶ BAN HÀNH NHIỆM KỲ 2025-2030'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        const absolute = path.resolve(candidate);
        if (await pathExists(absolute)) {
            return absolute;
        }
    }

    return null;
}

function normalizeTargetSheets(targetSheets) {
    if (!targetSheets) return DEFAULT_TARGET_SHEETS;

    if (Array.isArray(targetSheets)) {
        const normalized = targetSheets.map(normalizeText).filter(Boolean);
        return normalized.length ? normalized : DEFAULT_TARGET_SHEETS;
    }

    if (typeof targetSheets === 'string') {
        const normalized = targetSheets
            .split(',')
            .map(normalizeText)
            .filter(Boolean);
        return normalized.length ? normalized : DEFAULT_TARGET_SHEETS;
    }

    return DEFAULT_TARGET_SHEETS;
}

async function buildFileIndex(rootDir) {
    if (!rootDir || !(await pathExists(rootDir))) {
        return new Map();
    }

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

async function importAdminDocumentsFromWorkbook({ workbook, dataRoot = null, targetSheets = DEFAULT_TARGET_SHEETS }) {
    const normalizedSheets = normalizeTargetSheets(targetSheets);
    const targetSheetSet = new Set(normalizedSheets.map(normalizeText));
    const fileIndex = await buildFileIndex(dataRoot);

    let imported = 0;
    let skipped = 0;
    let missingFile = 0;

    for (const sheetName of workbook.SheetNames) {
        if (!targetSheetSet.has(normalizeText(sheetName))) continue;

        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet);

        for (const row of rows) {
            const documentCode = normalizeText(row['Mã tài liệu']).toUpperCase();
            if (!documentCode) {
                skipped += 1;
                continue;
            }

            const fileMeta = fileIndex.get(documentCode) || null;
            if (!fileMeta) missingFile += 1;

            await adminDocumentModel.upsert({
                document_code: documentCode,
                file_name: fileMeta?.file_name || null,
                file_path: fileMeta?.file_path || null,
                file_url: fileMeta ? buildDocumentUrl(documentCode) : null,
                symbol: normalizeText(row['Số ký hiệu văn bản']) || null,
                doc_type: normalizeText(row['Tên loại văn bản']) || sheetName,
                issued_date: parseDate(row['Ngày, tháng, năm văn bản']),
                issuer: normalizeText(row['Tên cơ quan ban hành']) || null,
                summary: normalizeText(row['Trích yếu nội dung']) || null,
                abstract: normalizeText(row['Tóm tắt']) || null,
                keywords: normalizeText(row['Từ khóa']) || null,
                ocr_status: null,
                ingest_status: null,
                last_error: null,
            });

            imported += 1;
        }
    }

    return {
        imported,
        skipped,
        missingFile,
        indexedFiles: fileIndex.size,
        targetSheets: normalizedSheets,
        dataRoot,
    };
}

async function importAdminDocumentsFromExcelPath({ excelPath, dataRoot = null, targetSheets = DEFAULT_TARGET_SHEETS }) {
    const absoluteExcelPath = path.resolve(excelPath);
    const workbook = xlsx.readFile(absoluteExcelPath);
    return importAdminDocumentsFromWorkbook({ workbook, dataRoot, targetSheets });
}

module.exports = {
    DEFAULT_TARGET_SHEETS,
    normalizeText,
    parseDate,
    buildDocumentUrl,
    pathExists,
    resolveExcelPath,
    resolveDataRoot,
    normalizeTargetSheets,
    buildFileIndex,
    importAdminDocumentsFromWorkbook,
    importAdminDocumentsFromExcelPath,
};
