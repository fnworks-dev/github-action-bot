import { config } from '../config.js';
const DEFAULT_TIMEOUT_MS = parsePositiveInt(process.env.SIDEQUEST_AI_TIMEOUT_MS, 15_000);
const DEFAULT_MAX_ATTEMPTS = parsePositiveInt(process.env.SIDEQUEST_AI_MAX_ATTEMPTS, 2);
const DEFAULT_RETRY_BASE_DELAY_MS = parsePositiveInt(process.env.SIDEQUEST_AI_RETRY_BASE_DELAY_MS, 1_500);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
class ProviderError extends Error {
    provider;
    status;
    retryable;
    constructor(provider, status, retryable, message) {
        super(message);
        this.provider = provider;
        this.status = status;
        this.retryable = retryable;
        this.name = 'ProviderError';
    }
}
function parsePositiveInt(raw, fallback) {
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function sanitizeText(text) {
    return text
        .replace(/<think\b[^>]*>[\s\S]*?(<\/think>|$)/gi, '')
        .trim();
}
function extractGeminiText(data) {
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
        return null;
    }
    const cleaned = sanitizeText(text);
    return cleaned.length > 0 ? cleaned : null;
}
function extractNvidiaNimText(data) {
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
        const cleaned = sanitizeText(content);
        return cleaned.length > 0 ? cleaned : null;
    }
    if (Array.isArray(content)) {
        const cleaned = sanitizeText(content
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join(''));
        return cleaned.length > 0 ? cleaned : null;
    }
    return null;
}
function isAbortError(error) {
    return error instanceof Error && error.name === 'AbortError';
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function getRetryDelayMs(attempt) {
    const jitter = Math.floor(Math.random() * 250);
    return DEFAULT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
}
async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timeout);
    }
}
function toProviderError(provider, error) {
    if (error instanceof ProviderError) {
        return error;
    }
    if (isAbortError(error)) {
        return new ProviderError(provider, null, true, `${provider} request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ProviderError(provider, null, true, `${provider} network error: ${message}`);
}
async function runProviderWithRetries(provider, taskLabel, fn) {
    let lastError = null;
    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
        try {
            console.log(`🤖 Using ${provider} for ${taskLabel} (attempt ${attempt}/${DEFAULT_MAX_ATTEMPTS})`);
            return await fn();
        }
        catch (error) {
            const providerError = toProviderError(provider, error);
            lastError = providerError;
            console.warn(`⚠️ ${provider} failed for ${taskLabel}: ${providerError.message}`);
            if (!providerError.retryable || attempt >= DEFAULT_MAX_ATTEMPTS) {
                break;
            }
            const delayMs = getRetryDelayMs(attempt);
            console.log(`⏳ Retrying ${provider} for ${taskLabel} in ${delayMs}ms...`);
            await sleep(delayMs);
        }
    }
    throw lastError || new ProviderError(provider, null, false, `${provider} failed for ${taskLabel}`);
}
async function generateWithGemini(options) {
    let response;
    try {
        response = await fetchWithTimeout(`${config.ai.geminiUrl}?key=${config.ai.geminiKey}`, {
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
        }, DEFAULT_TIMEOUT_MS);
    }
    catch (error) {
        throw toProviderError('Gemini', error);
    }
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ProviderError('Gemini', response.status, RETRYABLE_STATUS_CODES.has(response.status), `Gemini API error: ${response.status} ${errorText.slice(0, 200)}`);
    }
    const data = await response.json();
    const text = extractGeminiText(data);
    if (!text) {
        throw new ProviderError('Gemini', response.status, true, 'Gemini API returned empty content');
    }
    return text;
}
async function generateWithNvidiaNim(options) {
    let response;
    try {
        response = await fetchWithTimeout(config.ai.nvidiaNimUrl, {
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
        }, DEFAULT_TIMEOUT_MS);
    }
    catch (error) {
        throw toProviderError('NVIDIA NIM', error);
    }
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ProviderError('NVIDIA NIM', response.status, RETRYABLE_STATUS_CODES.has(response.status), `NVIDIA NIM API error: ${response.status} ${errorText.slice(0, 200)}`);
    }
    const data = await response.json();
    const text = extractNvidiaNimText(data);
    if (!text) {
        throw new ProviderError('NVIDIA NIM', response.status, true, 'NVIDIA NIM API returned empty content');
    }
    return text;
}
export async function generateTextWithFallback(options) {
    const errors = [];
    if (config.ai.nvidiaNimKey) {
        try {
            return await runProviderWithRetries('NVIDIA NIM', options.taskLabel, () => generateWithNvidiaNim(options));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`NVIDIA NIM: ${message}`);
        }
    }
    if (config.ai.geminiKey) {
        try {
            return await runProviderWithRetries('Gemini', options.taskLabel, () => generateWithGemini(options));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`Gemini: ${message}`);
        }
    }
    throw new Error(errors.length > 0
        ? `All AI providers failed for ${options.taskLabel}: ${errors.join(' | ')}`
        : `No AI providers configured for ${options.taskLabel}`);
}
