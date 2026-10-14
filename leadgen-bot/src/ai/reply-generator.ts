import { config } from '../config.js';
import { generateWithGemini } from './gemini.js';
import type { RawPost } from '../types.js';

const REPLY_PROMPT = `You are FNworks, a web development agency. Generate a helpful, friendly reply to this post.

Title: {title}
Content: {content}
Source: {source}

Requirements:
- Be helpful and offer value first
- Don't be overly salesy
- Keep it under 100 words
- End with a question to encourage response

Return JSON format:
{
  "reply": "your suggested reply here"
}
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Generate reply with retry
async function callWithRetry(
    fn: () => Promise<string>,
    name: string,
    maxRetries = 2
): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`   ⏳ Retry ${attempt}/${maxRetries}, waiting ${delay / 1000}s...`);
                await sleep(delay);
            }
            return await fn();
        } catch (error: any) {
            const isRateLimit = error.message?.includes('429');
            const is4xx = error.message?.includes('4');
            if ((isRateLimit || is4xx) && attempt < maxRetries) {
                continue;
            }
            throw error;
        }
    }
    throw new Error(`${name} failed after ${maxRetries} attempts`);
}

export async function generateReply(lead: RawPost): Promise<string> {
    const prompt = REPLY_PROMPT
        .replace('{title}', lead.title)
        .replace('{content}', lead.content || '(no content)')
        .replace('{source}', lead.subreddit || lead.source);

    try {
        let content: string = '';

        if (config.ai.geminiKey) {
            try {
                content = await callWithRetry(() => generateWithGemini(prompt, { temperature: 0.7, maxOutputTokens: 300 }), 'Gemini', 2);
            } catch (geminiError: any) {
                console.log(`   ⚠️ Gemini failed: ${geminiError.message}`);
            }
        }

        // If both AI failed, return empty string
        if (!content) {
            console.log('   ⚠️ Unable to generate reply (AI unavailable)');
            return '';
        }

        // Parse JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.log('   ⚠️ No JSON in AI response');
            return '';
        }

        const result = JSON.parse(jsonMatch[0]);
        return result.reply || '';
    } catch (error: any) {
        console.error('Reply generation error:', error.message);
        return '';
    }
}
