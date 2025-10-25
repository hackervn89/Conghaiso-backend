require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const db = require('./src/config/database');
const aiService = require('./src/services/aiService');
const knowledgeModel = require('./src/models/knowledgeModel');

const SOURCE_FILE = path.join(__dirname, 'tài liệu kỹ thuật.txt');
const CATEGORY = 'Kỹ thuật tổng quan';
const SOURCE_DOCUMENT = 'tài liệu kỹ thuật.txt';

/**
 * Chia một văn bản lớn thành các đoạn nhỏ (chunks).
 * Logic này chia theo các dòng trống.
 * @param {string} text - Nội dung văn bản.
 * @returns {string[]} - Mảng các chunks.
 */
function chunkText(text) {
    // Chia văn bản thành các đoạn dựa trên hai hoặc nhiều ký tự xuống dòng
    const chunks = text.split(/\n\s*\n/);
    return chunks.filter(chunk => chunk.trim().length > 50); // Lọc bỏ các đoạn quá ngắn
}

async function main() {
    console.log('Starting knowledge seeding process...');

    let client;
    try {
        // Đảm bảo kết nối CSDL sẵn sàng
        client = await db.getClient();
        console.log('Database connection established.');

        // 1. Đọc file tài liệu
        console.log(`Reading source file: ${SOURCE_FILE}`);
        const documentContent = await fs.readFile(SOURCE_FILE, 'utf-8');

        // 2. Cắt nhỏ (Chunking)
        const chunks = chunkText(documentContent);
        console.log(`Document split into ${chunks.length} chunks.`);

        if (chunks.length === 0) {
            console.log('No chunks to process. Exiting.');
            return;
        }

        // 3. Vòng lặp: Tạo embedding và INSERT vào CSDL
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`Processing chunk ${i + 1}/${chunks.length}...`);

            // Tạo embedding
            const embedding = await aiService.generateEmbedding(chunk);

            // Insert vào CSDL
            await knowledgeModel.create({
                content: chunk,
                category: CATEGORY,
                source_document: SOURCE_DOCUMENT,
                embedding: embedding,
            });

            console.log(`Chunk ${i + 1} has been ingested.`);
        }

        console.log('✅ Knowledge seeding process completed successfully!');
    } catch (error) {
        console.error('❌ An error occurred during the seeding process:', error);
    } finally {
        if (client) client.release();
        console.log('Database connection released.');
    }
}

main();