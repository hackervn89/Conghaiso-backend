const knowledgeModel = require('../models/knowledgeModel');
const aiService = require('../services/aiService');
const storageService = require('../services/storageService');
const fs = require('fs/promises');
const pdf = require('pdf-extraction');
const mammoth = require('mammoth');
const path = require('path');
const { GoogleGenerativeAI, TaskType } = require('@google/generative-ai');

const SIMILARITY_THRESHOLD = 0.5; 
const MAX_TOKENS_PER_CHUNK = 4000; // Giới hạn an toàn cho Flash Model
const OVERLAP_SENTENCES_COUNT = 2; // Giảm overlap để tránh lặp nội dung thừa

/**
 * Tính toán độ tương đồng cosine giữa hai vector.
 */
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * [ĐÃ SỬA CHỮA] Xác định cấp độ tiêu đề theo chiến lược 3 cấp.
 * Chỉ bắt các tiêu đề lớn (Thôn, La Mã, Số thứ tự).
 * Bỏ qua các mục nhỏ (-, +, a, b) để gộp vào nội dung.
 */
function getHeadingInfo(line) {
    const text = line.trim();

    const patterns = [
        // --- CẤP 1 (Root): Tên Thôn / Phần lớn ---
        // Bắt: "A. THÔN...", "PHẦN I", "CHƯƠNG I"
        { 
            level: 1, 
            regex: /^(PHẦN\s+|CHƯƠNG\s+|[A-Z]\.\s+THÔN|[A-Z]\.\s+)/i 
        },

        // --- CẤP 2 (Group): Số La Mã (Lĩnh vực lớn) ---
        // Bắt: "I. Đặc điểm", "II. Tình hình", "Mục A"
        { 
            level: 2, 
            regex: /^(MỤC\s+|[IVXLC]+\.\s+)/i 
        },

        // --- CẤP 3 (Detail): Số thứ tự (Nội dung chi tiết) ---
        // Bắt: "1. Vị trí", "2. Dân số", "Điều 1", "1.1."
        { 
            level: 3, 
            regex: /^(ĐIỀU\s+\d+|(\d+\.)+\s+)/i 
        }
    ];

    for (const { level, regex } of patterns) {
        if (regex.test(text)) {
            return { level, title: text };
        }
    }
    // Không khớp 3 cấp trên -> Trả về null (Coi là nội dung bình thường để gộp vào chunk trước)
    return null;
}

/**
 * Chia văn bản thành các chunk thông minh dựa trên cấu trúc và ngữ nghĩa.
 */
async function chunkText(text, modelForTokens) { 
    console.log('[Chunking] Bắt đầu quy trình chia nhỏ văn bản (Smart Structural Split)...');

    // 1. Tách câu, xử lý các ký tự xuống dòng và khoảng trắng
    // Regex này tách câu dựa trên dấu chấm, hỏi, cảm thán nhưng tránh các từ viết tắt
    const splitRegex = /(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|!)\s+/g;
    const normalizedText = text.replace(/(\r\n|\n|\r)/gm, " "); 
    
    // Lọc bỏ các câu quá ngắn hoặc rỗng
    const MIN_SENTENCE_LENGTH = 5;
    const sentences = normalizedText.split(splitRegex).map(s => {
        return s.replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').replace(/\s\s+/g, ' ').trim();
    }).filter(s => s.length >= MIN_SENTENCE_LENGTH);

    if (sentences.length === 0) return [];
    
    // 2. Tạo embedding ngữ nghĩa để hỗ trợ quyết định cắt (nếu cần)
    // Lưu ý: Nếu văn bản quá dài, bước này có thể tốn thời gian. 
    // Với chiến lược Heading-Base mới, ta có thể bỏ qua bước này để tăng tốc nếu muốn, 
    // nhưng giữ lại để xử lý các đoạn văn xuôi dài không có tiêu đề.
    let similarities = [];
    try {
        const embeddings = await aiService.generateEmbedding(sentences, TaskType.SEMANTIC_SIMILARITY);
        for (let i = 0; i < embeddings.length - 1; i++) {
            similarities.push(cosineSimilarity(embeddings[i], embeddings[i + 1]));
        }
    } catch (e) {
        console.warn("[Chunking] Không thể tạo embedding ngữ nghĩa, sẽ chỉ dùng cấu trúc Header.", e.message);
        // Fallback: giả định tương đồng cao để ưu tiên cắt theo Header
        similarities = new Array(sentences.length).fill(0.9); 
    }

    // 3. Vòng lặp chia chunk
    const chunks = [];
    const headingStack = []; // Stack lưu ngữ cảnh: [Thôn A, Kinh tế, Dân số]
    let currentChunkSentences = [];

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const headingInfo = getHeadingInfo(sentence);

        let shouldSplit = false;

        // --- LOGIC QUYẾT ĐỊNH CẮT (CORE LOGIC) ---
        if (i > 0) {
            const similarity = similarities[i - 1] || 0.5;
            const potentialChunkContent = [...currentChunkSentences, sentence].join(' ');
            // Đếm token ước lượng (nhanh hơn gọi API) hoặc gọi API nếu cần chính xác tuyệt đối
            // Ở đây gọi API đếm token vì đã truyền model vào
            const { totalTokens } = await modelForTokens.countTokens(potentialChunkContent);

            if (headingInfo) {
                // ƯU TIÊN 1: Gặp tiêu đề xịn (Cấp 1, 2, 3) -> CẮT NGAY
                shouldSplit = true;
            } else if (totalTokens > MAX_TOKENS_PER_CHUNK) {
                // ƯU TIÊN 2: Quá dài -> CẮT
                shouldSplit = true;
            } else if (similarity < SIMILARITY_THRESHOLD && currentChunkSentences.length > 5) {
                // ƯU TIÊN 3: Khác biệt ngữ nghĩa và chunk đã đủ dài -> CẮT
                shouldSplit = true;
            }
        }

        if (shouldSplit) {
            // Lưu chunk cũ
            if (currentChunkSentences.length > 0) {
                let chunkContent = currentChunkSentences.join(' ').trim();
                // Gắn ngữ cảnh từ Stack (Context Injection)
                if (headingStack.length > 0) {
                    const hierarchicalTitle = headingStack.map(h => h.title).join(' > ');
                    chunkContent = `Tiêu đề: ${hierarchicalTitle}\nNội dung: ${chunkContent}`;
                }
                chunks.push(chunkContent);
            }

            // Reset cho chunk mới (có overlap nhẹ để liền mạch)
            const overlap = currentChunkSentences.slice(-OVERLAP_SENTENCES_COUNT);
            // Nếu là heading mới thì không cần overlap với nội dung cũ, bắt đầu mới luôn
            currentChunkSentences = headingInfo ? [sentence] : [...overlap, sentence];
        } else {
            currentChunkSentences.push(sentence);
        }

        // --- CẬP NHẬT STACK TIÊU ĐỀ ---
        if (headingInfo) {
            // Nếu gặp cấp nhỏ hơn hoặc bằng cấp hiện tại trong stack -> Pop ra
            // Ví dụ: Đang ở [I. Kinh tế], gặp [II. Văn hóa] -> Pop [I. Kinh tế] ra, Push [II. Văn hóa] vào
            while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= headingInfo.level) {
                headingStack.pop();
            }
            headingStack.push(headingInfo);
        }
    }

    // Lưu chunk cuối cùng
    if (currentChunkSentences.length > 0) {
        let lastChunkContent = currentChunkSentences.join(' ').trim();
        if (headingStack.length > 0) {
            const hierarchicalTitle = headingStack.map(h => h.title).join(' > ');
            lastChunkContent = `Tiêu đề: ${hierarchicalTitle}\nNội dung: ${lastChunkContent}`;
        }
        chunks.push(lastChunkContent);
    }

    return chunks.map(c => c.trim()).filter(c => c.length > 0);
}

const createKnowledge = async (req, res) => {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelForTokens = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    
    try {
        const { category, tempFilePath } = req.body;
        if (!tempFilePath) return res.status(400).json({ message: 'tempFilePath is required.' });

        const { finalPath, originalName } = await storageService.moveFileToKnowledgeFolder(tempFilePath);
        const absoluteFilePath = path.join(storageService.STORAGE_BASE_PATH, finalPath);
        
        let fileContent = '';
        const fileExtension = path.extname(originalName).toLowerCase();

        if (fileExtension === '.docx') {
            const result = await mammoth.extractRawText({ path: absoluteFilePath });
            fileContent = result.value;
        } else if (fileExtension === '.pdf') {
            const dataBuffer = await fs.readFile(absoluteFilePath);
            const data = await pdf(dataBuffer);
            fileContent = data.text;
        } else if (fileExtension === '.txt') {
            fileContent = await fs.readFile(absoluteFilePath, 'utf-8');
        } else {
            return res.status(400).json({ message: 'Unsupported file type.' });
        }

        // Gọi hàm chunkText mới
        const chunks = await chunkText(fileContent, modelForTokens);
        
        if (chunks.length === 0) return res.status(400).json({ message: 'No content extracted.' });

        console.log(`[Knowledge] Creating embeddings for ${chunks.length} chunks...`);
        const sanitizedChunks = chunks.map(chunk => chunk.replace(/\x00/g, ''));
        const embeddings = await aiService.generateEmbedding(sanitizedChunks, TaskType.RETRIEVAL_DOCUMENT);

        const ingestedChunks = [];
        for (let i = 0; i < sanitizedChunks.length; i++) {
            const newKnowledge = await knowledgeModel.create({
                content: sanitizedChunks[i],
                category: category || 'Uncategorized',
                source_document: originalName,
                embedding: embeddings[i]
            });
            ingestedChunks.push(newKnowledge);
        }

        res.status(201).json({ message: `Ingested ${ingestedChunks.length} chunks.`, chunks: ingestedChunks });
    } catch (error) {
        console.error('Error creating knowledge:', error);
        res.status(500).json({ message: 'Server error.' });
    }
};

const updateKnowledge = async (req, res) => {
    try {
        const { id } = req.params;
        const { content, category, source_document } = req.body; 
        if (!content) return res.status(400).json({ message: 'Content required.' });

        const embedding = await aiService.generateEmbedding(content, TaskType.RETRIEVAL_DOCUMENT);
        const updated = await knowledgeModel.update(id, { content, category, source_document, embedding });

        if (!updated) return res.status(404).json({ message: 'Not found.' });
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const deleteKnowledge = async (req, res) => {
    try {
        await knowledgeModel.remove(req.params.id);
        res.status(200).json({ message: 'Deleted.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const getKnowledgeList = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 15;
        const result = await knowledgeModel.findAll(page, limit);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const getKnowledgeById = async (req, res) => {
    try {
        const knowledge = await knowledgeModel.findById(req.params.id);
        if (!knowledge) return res.status(404).json({ message: 'Not found.' });
        res.status(200).json(knowledge);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

const createKnowledgeFromText = async (req, res) => {
    // Để cho an toàn, ta vẫn dùng model để đếm token nếu cần thiết
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelForTokens = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    try {
        let { text, chunks, category, source_document } = req.body;

        // [TÍNH NĂNG MỚI] Nếu người dùng gửi text thô, tự động chunking thông minh
        if (text && (!chunks || chunks.length === 0)) {
             console.log('[Manual Input] Đang chia nhỏ văn bản thủ công bằng AI Logic...');
             chunks = await chunkText(text, modelForTokens);
        }

        if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
            return res.status(400).json({ message: 'Dữ liệu không hợp lệ.' });
        }
        if (!source_document) return res.status(400).json({ message: 'source_document required.' });

        console.log(`[From Text] Embedding ${chunks.length} chunks...`);
        const sanitizedChunks = chunks.map(c => c.replace(/\x00/g, '').trim()).filter(c => c.length > 0);
        const embeddings = await aiService.generateEmbedding(sanitizedChunks, TaskType.RETRIEVAL_DOCUMENT);

        const ingestedChunks = [];
        for (let i = 0; i < sanitizedChunks.length; i++) {
            const newKnowledge = await knowledgeModel.create({
                content: sanitizedChunks[i],
                category: category || 'Uncategorized',
                source_document: source_document,
                embedding: embeddings[i]
            });
            ingestedChunks.push(newKnowledge);
        }

        res.status(201).json({ message: `Ingested ${ingestedChunks.length} chunks from text.`, chunks: ingestedChunks });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
};

module.exports = { createKnowledge, updateKnowledge, deleteKnowledge, getKnowledgeList, getKnowledgeById, createKnowledgeFromText };