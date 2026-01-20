import { config } from '../config.js';
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

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{ text: string }>;
        };
    }>;
    error?: { message: string };
}

interface GLMResponse {
    id: string;
    type: string;
    role: string;
    content: Array<{ type: string; text: string }>;
    model: string;
    stop_reason: string;
    usage?: {
        input_tokens: number;
        output_tokens: number;
    };
    error?: { message: string };
}

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

// Generate reply using Gemini
async function generateWithGemini(prompt: string): Promise<string> {
    const url = `${config.ai.geminiUrl}?key=${config.ai.geminiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 300,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.log(`   Gemini error ${response.status}: ${errorText.slice(0, 100)}`);
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data: GeminiResponse = await response.json();

    if (data.error) {
        throw new Error(`Gemini error: ${data.error.message}`);
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Generate reply using GLM (via Anthropic-compatible endpoint)
async function generateWithGLM(prompt: string): Promise<string> {
    const response = await fetch(config.ai.glmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.ai.glmKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', // Maps to GLM-4.7 via Z.ai proxy
            max_tokens: 300,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.log(`   GLM error ${response.status}: ${errorText.slice(0, 100)}`);
        throw new Error(`GLM API error: ${response.status}`);
    }

    const data: GLMResponse = await response.json();

    if (data.error) {
        throw new Error(`GLM error: ${data.error.message}`);
    }

    // Anthropic API format: content is an array of blocks
    return data.content?.[0]?.text || '';
}

export async function generateReply(lead: RawPost): Promise<string> {
    const prompt = REPLY_PROMPT
        .replace('{title}', lead.title)
        .replace('{content}', lead.content || '(no content)')
        .replace('{source}', lead.subreddit || lead.source);

    try {
        let content: string = '';

        // Try GLM first (primary - using Anthropic-compatible endpoint)
        if (config.ai.glmKey) {
            try {
                content = await callWithRetry(() => generateWithGLM(prompt), 'GLM', 2);
            } catch (glmError: any) {
                console.log(`   ⚠️ GLM failed: ${glmError.message}`);
            }
        }

        // Fallback to Gemini
        if (!content && config.ai.geminiKey) {
            try {
                content = await callWithRetry(() => generateWithGemini(prompt), 'Gemini', 2);
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
