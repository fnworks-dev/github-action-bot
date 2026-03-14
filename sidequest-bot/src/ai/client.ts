import { config } from '../config.js';

interface AITextOptions {
    prompt: string;
    temperature: number;
    maxOutputTokens: number;
    taskLabel: string;
}

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
}

interface NvidiaNimResponse {
    choices?: Array<{
        message?: {
            content?: string | Array<{ text?: string }>;
        };
    }>;
}

function sanitizeText(text: string): string {
    return text
        .replace(/<think\b[^>]*>[\s\S]*?(<\/think>|$)/gi, '')
        .trim();
}

function extractGeminiText(data: GeminiResponse): string | null {
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
        return null;
    }

    const cleaned = sanitizeText(text);
    return cleaned.length > 0 ? cleaned : null;
}

function extractNvidiaNimText(data: NvidiaNimResponse): string | null {
    const content = data.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
        const cleaned = sanitizeText(content);
        return cleaned.length > 0 ? cleaned : null;
    }

    if (Array.isArray(content)) {
        const cleaned = sanitizeText(
            content
                .map((part) => (typeof part?.text === 'string' ? part.text : ''))
                .join('')
        );
        return cleaned.length > 0 ? cleaned : null;
    }

    return null;
}

async function generateWithGemini(options: AITextOptions): Promise<string> {
    const response = await fetch(`${config.ai.geminiUrl}?key=${config.ai.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: options.prompt }]
            }],
            generationConfig: {
                temperature: options.temperature,
                maxOutputTokens: options.maxOutputTokens,
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini API error: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json() as GeminiResponse;
    const text = extractGeminiText(data);
    if (!text) {
        throw new Error('Gemini API returned empty content');
    }

    return text;
}

async function generateWithNvidiaNim(options: AITextOptions): Promise<string> {
    const response = await fetch(config.ai.nvidiaNimUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.ai.nvidiaNimKey}`,
        },
        body: JSON.stringify({
            model: config.ai.nvidiaNimModel,
            max_tokens: options.maxOutputTokens,
            temperature: options.temperature,
            messages: [{
                role: 'user',
                content: options.prompt,
            }],
        })
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`NVIDIA NIM API error: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json() as NvidiaNimResponse;
    const text = extractNvidiaNimText(data);
    if (!text) {
        throw new Error('NVIDIA NIM API returned empty content');
    }

    return text;
}

export async function generateTextWithFallback(options: AITextOptions): Promise<string> {
    const errors: string[] = [];

    if (config.ai.geminiKey) {
        try {
            console.log(`🤖 Using Gemini for ${options.taskLabel}`);
            return await generateWithGemini(options);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`Gemini: ${message}`);
            console.warn(`⚠️ Gemini failed for ${options.taskLabel}:`, error);
        }
    }

    if (config.ai.nvidiaNimKey) {
        try {
            console.log(`🤖 Using NVIDIA NIM fallback for ${options.taskLabel}`);
            return await generateWithNvidiaNim(options);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`NVIDIA NIM: ${message}`);
            console.warn(`⚠️ NVIDIA NIM failed for ${options.taskLabel}:`, error);
        }
    }

    throw new Error(
        errors.length > 0
            ? `All AI providers failed for ${options.taskLabel}: ${errors.join(' | ')}`
            : `No AI providers configured for ${options.taskLabel}`
    );
}
