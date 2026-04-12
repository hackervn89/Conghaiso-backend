require('dotenv').config();
const {
    resolveExcelPath,
    resolveDataRoot,
    importAdminDocumentsFromExcelPath,
} = require('../src/services/adminDocumentImportService');

async function main() {
    const excelPath = await resolveExcelPath();
    const dataRoot = await resolveDataRoot();

    console.log(`[IMPORT] Excel path: ${excelPath}`);
    console.log(`[IMPORT] Data root: ${dataRoot || 'NOT FOUND'}`);

    const result = await importAdminDocumentsFromExcelPath({
        excelPath,
        dataRoot,
    });

    console.log(`Imported: ${result.imported}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Missing file mapping: ${result.missingFile}`);
    console.log(`Indexed files: ${result.indexedFiles}`);
}

main().catch((error) => {
    if (error.message === 'EXCEL_FILE_NOT_FOUND') {
        console.error('Import admin documents failed: Không tìm thấy file Excel metadata. Hãy đặt biến ADMIN_DOCS_EXCEL_PATH hoặc đặt file đúng vị trí.');
    } else {
        console.error('Import admin documents failed:', error);
    }
    process.exit(1);
});
