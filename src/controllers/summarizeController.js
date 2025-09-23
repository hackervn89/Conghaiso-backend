const { GoogleGenerativeAI } = require("@google/generative-ai");
const { extractFileIdFromUrl, exportDocumentContent } = require("../services/googleDriveService");
const axios = require('axios');
// const cheerio = require('cheerio');

// Khởi tạo Gemini AI với khóa API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Change model name here
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const MAX_TOKENS_PER_CHUNK = 100000; // Adjust based on testing and Gemini limits

// Helper function to chunk document content based on estimated token count
async function chunkDocumentContent(content) {
  const chunks = [];
  let currentChunk = '';
  // Split by words and keep delimiters to avoid breaking words
  const words = content.split(/(\s+)/); 

  for (const word of words) {
    // Estimate tokens for the current chunk + next word
    const { totalTokens } = await model.countTokens(currentChunk + word);
    if (totalTokens > MAX_TOKENS_PER_CHUNK && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = word;
    } else {
      currentChunk += word;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds

// Helper function to call Gemini API with retry logic
async function callGeminiWithRetry(prompt, retries = MAX_RETRIES, delay = INITIAL_RETRY_DELAY_MS) {
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    if (error.name === 'GoogleGenerativeAIFetchError' && error.message.includes('429 Too Many Requests') && retries > 0) {
      console.warn(`Received 429, retrying in ${delay / 1000} seconds... (Retries left: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callGeminiWithRetry(prompt, retries - 1, delay * 2); // Exponential back-off
    }
    throw error; // Re-throw if not 429 or no retries left
  }
}

const summarizeDocument = async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let documentContent = '';

  try {
    // --- Cố gắng lấy nội dung bằng Google Drive API (ưu tiên) ---
    const fileId = extractFileIdFromUrl(url);
    if (fileId) {
      try {
        documentContent = await exportDocumentContent(fileId);
        console.log('Content extracted using Google Drive API.');
      } catch (driveError) {
        console.warn(`Google Drive API failed for ${url}: ${driveError.message}. Attempting fallback.`);
        documentContent = ''; // Reset content for fallback
      }
    }

    // --- Nếu Google Drive API không thành công hoặc không phải URL Drive, thử phương pháp HTTP GET + Cheerio ---
    // if (!documentContent || documentContent.trim().length === 0) {
    //   console.log('Attempting to extract content using HTTP GET and Cheerio.');
    //   const response = await axios.get(url);
    //   const html = response.data;
    //   const $ = cheerio.load(html);
    //   documentContent = $('body').text(); // Trích xuất văn bản từ body HTML
    //   console.log('Content extracted using HTTP GET and Cheerio.');
    // }

    if (!documentContent || documentContent.trim().length === 0) {
      throw new Error('Could not extract any meaningful document content.');
    }

    // --- Debugging logs for document content ---
    console.log(`Extracted document content length: ${documentContent.length}`);
    console.log(`First 50 characters of content: ${documentContent.substring(0, 500)}`);

    // --- Tóm tắt bằng Gemini AI ---
    const { totalTokens } = await model.countTokens(documentContent);
    let finalSummary = '';

    if (totalTokens > MAX_TOKENS_PER_CHUNK) {
      console.log(`Document too large (${totalTokens} tokens). Chunking and summarizing.`);
      const chunks = await chunkDocumentContent(documentContent);
      const chunkSummaries = [];

      for (const chunk of chunks) {
        const chunkPrompt = `Tóm tắt đoạn văn bản sau:\n\n${chunk}`;
        const summary = await callGeminiWithRetry(chunkPrompt);
        chunkSummaries.push(summary);
      }

      // Summarize the summaries if there are many chunks
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
1.  Xác định và trích xuất các nội dung chính:
    - Mục đích, ý nghĩa của văn bản.
    - Các quyết định, chỉ thị, hoặc chủ trương quan trọng.
    - Các nhiệm vụ, giải pháp, hoặc kế hoạch hành động cụ thể.
2.  Trích xuất các số liệu và dữ liệu quan trọng:
    Tuyệt đối phải bảo toàn các con số, bao gồm:
      Các chỉ tiêu, mục tiêu cụ thể (ví dụ: "tăng trưởng 5%", "giảm 10%").
      Các mốc thời gian (ví dụ: "thực hiện trong giai đoạn 2025-2030", "hoàn thành trước ngày 31/12").
      Các định lượng tài chính hoặc ngân sách.
      Các số lượng, tần suất, hoặc thứ tự được đề cập.
    Liệt kê các số liệu này một cách rõ ràng và tách biệt trong bản tóm tắt.
3.  Tóm tắt phải đảm bảo:
    Ngắn gọn, súc tích: Tránh các câu văn dài dòng, lặp lại.
    Chính xác: Không diễn giải sai lệch ý của văn bản gốc.
    Trung lập và khách quan: Chỉ tóm tắt nội dung, không đưa ra ý kiến cá nhân.
    Có cấu trúc: Sử dụng các gạch đầu dòng hoặc đánh số để trình bày các điểm chính một cách dễ đọc.

4.  Định dạng đầu ra:
    Bản tóm tắt nên bắt đầu bằng một câu giới thiệu ngắn gọn về loại văn bản và chủ đề chính.
    Sử dụng gạch đầu dòng để trình bày các điểm chính.
    Sử dụng định dạng in đậm cho các từ khóa hoặc số liệu quan trọng.
:\n\n${documentContent}`;
      finalSummary = await callGeminiWithRetry(prompt);
    }

    res.json({ summary: finalSummary });

  } catch (error) {
    console.error('Lỗi tóm tắt tài liệu:', error);
    // Check for Gemini API specific errors
    if (error.name === 'GoogleGenerativeAIFetchError') {
        if (error.message.includes('503 Service Unavailable')) {
            res.status(503).json({ error: 'Gemini AI service is temporarily unavailable. Please try again later.' });
        } else if (error.message.includes('429 Too Many Requests')) {
            // Extract retry delay if available
            const retryDelayMatch = error.message.match(/retryDelay: '(\d+)s'/);
            const retryDelay = retryDelayMatch ? parseInt(retryDelayMatch[1]) : null;
            const retryMessage = retryDelay ? `Please try again after ${retryDelay} seconds.` : 'You have exceeded your Gemini AI quota (possibly Requests Per Minute). Please check your plan and billing details.';
            res.status(429).json({ error: `Gemini AI quota exceeded. ${retryMessage}` });
        } else {
            res.status(500).json({ error: 'An unexpected error occurred with Gemini AI. Please try again.' });
        }
    } else {
        res.status(500).json({ error: 'Không thể tóm tắt tài liệu. Vui lòng thử lại.' });
    }
  }
};

module.exports = {
  summarizeDocument,
};