const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs/promises');
const path = require('path');
const { STORAGE_BASE_PATH } = require('../services/storageService');
const { estimateTokens } = require('../services/chunkingService');

const SUMMARY_MODEL = process.env.SUMMARY_MODEL || process.env.CHAT_MODEL || 'gemini-3.1-flash-lite-preview';
const MAX_TOKENS_PER_CHUNK = parseInt(process.env.SUMMARY_MAX_TOKENS_PER_CHUNK || '120000', 10);
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 5000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: SUMMARY_MODEL });

function chunkDocumentContent(content) {
  const chunks = [];
  const paragraphs = content
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  let currentChunk = '';
  for (const paragraph of paragraphs) {
    const candidate = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
    if (estimateTokens(candidate) > MAX_TOKENS_PER_CHUNK && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk = candidate;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function callGeminiWithRetry(prompt, retries = MAX_RETRIES, delay = INITIAL_RETRY_DELAY_MS) {
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    const isRetryable =
      error.name === 'GoogleGenerativeAIFetchError' &&
      (error.message.includes('429') || error.message.includes('503'));

    if (isRetryable && retries > 0) {
      console.warn(`[Summarize] API bận/quá hạn mức, retry sau ${delay / 1000}s... (còn ${retries} lần)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return callGeminiWithRetry(prompt, retries - 1, delay * 2);
    }

    throw error;
  }
}

const summarizeDocument = async (req, res) => {
  const { filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  try {
    const absoluteFilePath = path.join(STORAGE_BASE_PATH, filePath);

    if (!absoluteFilePath.startsWith(STORAGE_BASE_PATH)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    let documentContent;
    try {
      documentContent = await fs.readFile(absoluteFilePath, 'utf8');
    } catch (readError) {
      if (readError.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found.' });
      }
      throw readError;
    }

    if (!documentContent || documentContent.trim().length === 0) {
      throw new Error('Could not extract any meaningful document content.');
    }

    const estimatedTokens = estimateTokens(documentContent);
    let finalSummary = '';

    if (estimatedTokens > MAX_TOKENS_PER_CHUNK) {
      const chunks = chunkDocumentContent(documentContent);
      const chunkSummaries = [];

      for (const chunk of chunks) {
        const chunkPrompt = `Tóm tắt đoạn văn bản sau:\n\n${chunk}`;
        const summary = await callGeminiWithRetry(chunkPrompt);
        chunkSummaries.push(summary);
      }

      if (chunkSummaries.length > 1) {
        const combinedSummaries = chunkSummaries.join('\n\n');
        const finalSummaryPrompt = `Tóm tắt các bản tóm tắt sau thành một bản tóm tắt duy nhất:\n\n${combinedSummaries}`;
        finalSummary = await callGeminiWithRetry(finalSummaryPrompt);
      } else {
        finalSummary = chunkSummaries[0];
      }
    } else {
      const prompt = `Bạn là một trợ lý AI chuyên tóm tắt văn bản hành chính nhà nước. Nhiệm vụ của bạn là đọc và hiểu toàn bộ nội dung của văn bản sau, sau đó tạo ra một bản tóm tắt toàn diện, chính xác và súc tích.
Yêu cầu tóm tắt:
1. Xác định và trích xuất các nội dung chính:
   - Mục đích, ý nghĩa của văn bản.
   - Các quyết định, chỉ thị, hoặc chủ trương quan trọng.
   - Các nhiệm vụ, giải pháp, hoặc kế hoạch hành động cụ thể.
2. Trích xuất các số liệu và dữ liệu quan trọng:
   - Bảo toàn các con số: chỉ tiêu, mốc thời gian, định lượng tài chính, số lượng/tần suất/thứ tự.
3. Tóm tắt phải đảm bảo:
   - Ngắn gọn, súc tích.
   - Chính xác, không suy diễn sai.
   - Trung lập, khách quan.
   - Có cấu trúc gạch đầu dòng hoặc đánh số.
4. Định dạng đầu ra:
   - Mở đầu bằng câu giới thiệu ngắn về văn bản.
   - In đậm từ khóa hoặc số liệu quan trọng.

Văn bản:
${documentContent}`;

      finalSummary = await callGeminiWithRetry(prompt);
    }

    const formattedSummary = finalSummary.replace(/chatCHS/gi, '**chatCHS**');
    return res.json({ summary: formattedSummary });
  } catch (error) {
    console.error('Lỗi tóm tắt tài liệu:', error);

    if (error.name === 'GoogleGenerativeAIFetchError') {
      if (error.message.includes('503')) {
        return res.status(503).json({ error: 'Gemini AI service is temporarily unavailable. Please try again later.' });
      }
      if (error.message.includes('429')) {
        return res.status(429).json({ error: 'Gemini AI quota exceeded. Please try again later.' });
      }
      return res.status(500).json({ error: 'An unexpected error occurred with Gemini AI. Please try again.' });
    }

    return res.status(500).json({ error: 'Không thể tóm tắt tài liệu. Vui lòng thử lại.' });
  }
};

module.exports = {
  summarizeDocument,
};
