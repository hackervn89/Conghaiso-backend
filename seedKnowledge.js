require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const db = require('./src/config/database');
const aiService = require('./src/services/aiService');
const { generateKnowledgeChunks } = require('./src/services/chunkingService');
const { TaskType } = require('@google/generative-ai');
const knowledgeModel = require('./src/models/knowledgeModel');

const SOURCE_FILE = path.join(__dirname, 'tài liệu kỹ thuật.txt');
const CATEGORY = 'Kỹ thuật tổng quan';
const SOURCE_DOCUMENT = 'tài liệu kỹ thuật.txt';

async function main() {
    console.log('Starting knowledge seeding process...');

    let client;
    try {
        client = await db.getClient();
        console.log('Database connection established.');

        console.log(`Reading source file: ${SOURCE_FILE}`);
        const documentContent = await fs.readFile(SOURCE_FILE, 'utf-8');

        const chunks = generateKnowledgeChunks(documentContent);
        console.log(`Document split into ${chunks.length} chunks.`);

        if (chunks.length === 0) {
            console.log('No chunks to process. Exiting.');
            return;
        }

        const sanitizedChunks = chunks.map(c => c.replace(/\x00/g, '').trim()).filter(Boolean);
        const embeddings = await aiService.generateEmbedding(sanitizedChunks, TaskType.RETRIEVAL_DOCUMENT, SOURCE_DOCUMENT);

        for (let i = 0; i < sanitizedChunks.length; i++) {
            console.log(`Processing chunk ${i + 1}/${sanitizedChunks.length}...`);

            await knowledgeModel.create({
                content: sanitizedChunks[i],
                category: CATEGORY,
                source_document: SOURCE_DOCUMENT,
                embedding: embeddings[i],
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
