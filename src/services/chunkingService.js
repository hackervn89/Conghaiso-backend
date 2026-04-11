const DEFAULT_OPTIONS = {
    shortDocTokenThreshold: 900,
    targetChunkTokens: 900,
    maxChunkTokens: 1300,
    overlapSentences: 2,
    minChunkChars: 120,
};

function estimateTokens(text = '') {
    if (!text) return 0;
    // Ước lượng nhanh, ổn định, không phụ thuộc API countTokens.
    // Kinh nghiệm thực tế: tiếng Việt thường ~3.5-4.5 ký tự/token.
    return Math.ceil(text.length / 4);
}

function normalizeTextForChunking(text = '') {
    return text
        .replace(/\u00A0/g, ' ') // non-breaking space
        .replace(/[\t\f\v]+/g, ' ')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ ]{2,}/g, ' ')
        .trim();
}

function splitSentencesVi(text = '') {
    if (!text) return [];

    const normalized = text
        .replace(/\n+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!normalized) return [];

    // Chấp nhận tách câu theo dấu chấm/chấm hỏi/chấm than + khoảng trắng.
    // Đơn giản và an toàn cho văn bản hành chính tiếng Việt.
    const parts = normalized.split(/(?<=[.!?])\s+/g);
    return parts.map(s => s.trim()).filter(Boolean);
}

function getHeadingInfo(line = '') {
    const text = line.trim();
    if (!text) return null;

    const patterns = [
        { level: 1, regex: /^(PHẦN|CHƯƠNG)\s+[IVXLC\d]+/i },
        { level: 1, regex: /^[A-ZĐ]\.\s+/i },
        { level: 2, regex: /^[IVXLC]+\.\s+/i },
        { level: 3, regex: /^\d+(\.\d+)*\.\s+/ },
        { level: 3, regex: /^(ĐIỀU|KHOẢN|MỤC)\s+\d+/i },
    ];

    for (const pattern of patterns) {
        if (pattern.regex.test(text)) {
            return { level: pattern.level, title: text };
        }
    }

    return null;
}

function detectStructuredDocument(lines = []) {
    let headingHits = 0;
    for (const line of lines) {
        if (getHeadingInfo(line)) headingHits += 1;
        if (headingHits >= 3) return true;
    }
    return false;
}

function buildSectionsFromLines(lines = []) {
    const sections = [];
    const headingStack = [];
    let currentContent = [];

    const flushSection = () => {
        const content = currentContent.join(' ').replace(/\s{2,}/g, ' ').trim();
        if (!content) return;

        const sectionPath = headingStack.map(h => h.title).join(' > ');
        sections.push({
            sectionPath,
            content,
        });
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const heading = getHeadingInfo(line);
        if (heading) {
            flushSection();
            currentContent = [line];

            while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= heading.level) {
                headingStack.pop();
            }
            headingStack.push(heading);
        } else {
            currentContent.push(line);
        }
    }

    flushSection();

    // Fallback nếu không xây được section hợp lệ.
    if (sections.length === 0) {
        const fallbackContent = lines.join(' ').replace(/\s{2,}/g, ' ').trim();
        if (fallbackContent) {
            sections.push({ sectionPath: '', content: fallbackContent });
        }
    }

    return sections;
}

function chunkByTokenWindow(text, options = {}, sectionPath = '') {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const sentences = splitSentencesVi(text);

    if (sentences.length === 0) return [];

    const chunks = [];
    let currentSentences = [];
    let currentTokens = 0;

    const pushChunk = () => {
        if (currentSentences.length === 0) return;
        let content = currentSentences.join(' ').trim();
        if (!content || content.length < mergedOptions.minChunkChars) return;

        if (sectionPath) {
            content = `Tiêu đề: ${sectionPath}\nNội dung: ${content}`;
        }

        chunks.push(content);
    };

    for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);

        if (
            currentSentences.length > 0
            && (currentTokens + sentenceTokens > mergedOptions.maxChunkTokens)
        ) {
            pushChunk();

            const overlap = currentSentences.slice(-mergedOptions.overlapSentences);
            currentSentences = [...overlap, sentence];
            currentTokens = estimateTokens(currentSentences.join(' '));
            continue;
        }

        currentSentences.push(sentence);
        currentTokens += sentenceTokens;

        if (currentTokens >= mergedOptions.targetChunkTokens) {
            pushChunk();
            const overlap = currentSentences.slice(-mergedOptions.overlapSentences);
            currentSentences = [...overlap];
            currentTokens = estimateTokens(currentSentences.join(' '));
        }
    }

    pushChunk();

    return chunks;
}

function chunkPlainDocument(text, options = {}) {
    const paragraphs = text
        .split(/\n\s*\n/g)
        .map(p => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    if (paragraphs.length === 0) return [];

    const chunks = [];
    let buffer = '';

    for (const paragraph of paragraphs) {
        const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;

        if (estimateTokens(candidate) > (options.maxChunkTokens || DEFAULT_OPTIONS.maxChunkTokens) && buffer) {
            chunks.push(...chunkByTokenWindow(buffer, options));
            buffer = paragraph;
        } else {
            buffer = candidate;
        }
    }

    if (buffer) {
        chunks.push(...chunkByTokenWindow(buffer, options));
    }

    return chunks;
}

function generateKnowledgeChunks(rawText, options = {}) {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const cleanText = normalizeTextForChunking(rawText || '');

    if (!cleanText) return [];

    // Quy tắc tài liệu ngắn (thường là công văn 1 trang): giữ nguyên 1 chunk để bảo toàn ngữ cảnh.
    if (estimateTokens(cleanText) <= mergedOptions.shortDocTokenThreshold) {
        return [cleanText];
    }

    const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
    const isStructured = detectStructuredDocument(lines);

    if (isStructured) {
        const sections = buildSectionsFromLines(lines);
        const structuredChunks = [];

        for (const section of sections) {
            const sectionChunks = chunkByTokenWindow(section.content, mergedOptions, section.sectionPath);
            structuredChunks.push(...sectionChunks);
        }

        if (structuredChunks.length > 0) {
            return structuredChunks;
        }
    }

    // Fallback cho văn bản không cấu trúc rõ ràng
    return chunkPlainDocument(cleanText, mergedOptions);
}

module.exports = {
    estimateTokens,
    normalizeTextForChunking,
    generateKnowledgeChunks,
};
