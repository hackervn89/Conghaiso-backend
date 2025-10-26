require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const db = require('./src/config/database');
const aiService = require('./src/services/aiService');
const { TaskType } = require('@google/generative-ai');
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
    const MAX_CHUNK_SIZE = 8000;
    const separators = ["\n\n", "\n", " ", ""];

    function recursiveSplit(textToSplit, currentSeparators) {
        if (textToSplit.length <= MAX_CHUNK_SIZE) {
            return [textToSplit];
        }

        const separator = currentSeparators[0];
        const nextSeparators = currentSeparators.slice(1);

        if (!separator) { // Không còn dấu phân tách nào
            return [textToSplit];
        }

        const splits = textToSplit.split(separator);
        const goodSplits = [];
        let currentChunk = "";

        for (const split of splits) {
            if (currentChunk.length + split.length + separator.length > MAX_CHUNK_SIZE) {
                goodSplits.push(currentChunk.trim());
                currentChunk = split;
            } else {
                currentChunk += (currentChunk ? separator : "") + split;
            }
        }
        if (currentChunk) {
            goodSplits.push(currentChunk.trim());
        }

        const finalChunks = [];
        for (const chunk of goodSplits) {
            if (chunk.length > MAX_CHUNK_SIZE) {
                finalChunks.push(...recursiveSplit(chunk, nextSeparators));
            } else {
                finalChunks.push(chunk);
            }
        }
        return finalChunks;
    }

    const initialChunks = recursiveSplit(text, separators);
    
    const mergedChunks = [];
    let tempChunk = "";
    for (const chunk of initialChunks) {
        if ((tempChunk + chunk).length > MAX_CHUNK_SIZE) {
            mergedChunks.push(tempChunk);
            tempChunk = "";
        }
        tempChunk += (tempChunk ? "\n\n" : "") + chunk;
    }
    if (tempChunk) mergedChunks.push(tempChunk);

    return mergedChunks.filter(c => c.trim().length > 200); // Lọc bỏ các chunk quá ngắn
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
            const embedding = await aiService.generateEmbedding(chunk, TaskType.RETRIEVAL_DOCUMENT);

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