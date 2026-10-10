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
            parts?: Array<{ text?: string; thought?: boolean }>;
        };
        finishReason?: string;
    }>;
}

interface NvidiaNimResponse {
    choices?: Array<{
        message?: {
            content?: string | Array<{ text?: string }>;
        };
    }>;
}

const DEFAULT_TIMEOUT_MS = parsePositiveInt(process.env.SIDEQUEST_AI_TIMEOUT_MS, 15_000);
// Ollama models normally answer in 2-6s; stalls happen, so fail fast to the next model/tier.
const PROXY_TIMEOUT_MS = parsePositiveInt(process.env.LLM_PROXY_TIMEOUT_MS, 20_000);
const DEFAULT_MAX_ATTEMPTS = parsePositiveInt(process.env.SIDEQUEST_AI_MAX_ATTEMPTS, 2);
const DEFAULT_RETRY_BASE_DELAY_MS = parsePositiveInt(process.env.SIDEQUEST_AI_RETRY_BASE_DELAY_MS, 1_500);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

class ProviderError extends Error {
    constructor(
        public readonly provider: string,
        public readonly status: number | null,
        public readonly retryable: boolean,
        message: string
    ) {
        super(message);
        this.name = 'ProviderError';
    }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeText(text: string): string {
    return text
        .replace(/<think\b[^>]*>[\s\S]*?(<\/think>|$)/gi, '')
        .trim();
}

function extractGeminiText(data: GeminiResponse): string | null {
    const parts = data.candidates?.[0]?.content?.parts || [];

    // Thinking models (e.g. gemma-4) emit `thought: true` parts before the answer.
    // Prefer non-thought parts; fall back to all parts for non-thinking models.
    let texts = parts
        .filter((part) => part.thought !== true)
        .map((part) => (typeof part?.text === 'string' ? part.text : ''));
    if (texts.every((t) => t.length === 0)) {
        texts = parts.map((part) => (typeof part?.text === 'string' ? part.text : ''));
    }

    if (texts.length === 0) {
        return null;
    }

    const cleaned = sanitizeText(texts.join(''));
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

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number): number {
    const jitter = Math.floor(Math.random() * 250);
    return DEFAULT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

function toProviderError(provider: string, error: unknown): ProviderError {
    if (error instanceof ProviderError) {
        return error;
    }

    if (isAbortError(error)) {
        return new ProviderError(provider, null, true, `${provider} request timed out`);
    }

    const message = error instanceof Error ? error.message : String(error);
    return new ProviderError(provider, null, true, `${provider} network error: ${message}`);
}

async function runProviderWithRetries(
    provider: string,
    taskLabel: string,
    fn: () => Promise<string>,
    maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<string> {
    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            console.log(`🤖 Using ${provider} for ${taskLabel} (attempt ${attempt}/${maxAttempts})`);
            return await fn();
        } catch (error) {
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

async function generateWithGemini(options: AITextOptions): Promise<string> {
    const models = config.ai.geminiModels || [];
    const keys = [config.ai.geminiKey, ...(config.ai.geminiBackupKeys || [])].filter(Boolean);
    const baseUrl = config.ai.geminiBaseUrl || '';

    if (baseUrl && models.length > 0 && keys.length > 0) {
        let lastError: ProviderError | null = null;

        for (let ki = 0; ki < keys.length; ki += 1) {
            const key = keys[ki];
            for (const model of models) {
                const url = `${baseUrl}/${model}:generateContent?key=${key}`;
                let response: Response;

                try {
                    response = await fetchWithTimeout(url, {
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
                } catch (error) {
                    lastError = toProviderError('Gemini', error);
                    continue;
                }

                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    lastError = new ProviderError(
                        'Gemini',
                        response.status,
                        RETRYABLE_STATUS_CODES.has(response.status),
                        `Gemini API error: ${response.status} ${errorText.slice(0, 200)}`
                    );
                    continue;
                }

                const data = await response.json() as GeminiResponse;
                // A thinking model can spend the whole budget on thoughts; a cut-off answer is useless, try the next model.
                if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
                    lastError = new ProviderError('Gemini', response.status, true, `${model} answer cut off at maxOutputTokens`);
                    continue;
                }
                const text = extractGeminiText(data);
                if (!text) {
                    lastError = new ProviderError('Gemini', response.status, true, 'Gemini API returned empty content');
                    continue;
                }

                return text;
            }
        }

        throw lastError || new ProviderError('Gemini', null, true, 'All Gemini keys/models failed');
    }

    let response: Response;
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
    } catch (error) {
        throw toProviderError('Gemini', error);
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ProviderError(
            'Gemini',
            response.status,
            RETRYABLE_STATUS_CODES.has(response.status),
            `Gemini API error: ${response.status} ${errorText.slice(0, 200)}`
        );
    }

    const data = await response.json() as GeminiResponse;
    const text = extractGeminiText(data);
    if (!text) {
        throw new ProviderError('Gemini', response.status, true, 'Gemini API returned empty content');
    }

    return text;
}

// OpenAI-compatible chat completions (NVIDIA NIM, fnworks llm-proxy).
async function generateWithOpenAICompat(
    provider: string,
    url: string,
    key: string,
    models: string[],
    timeoutMs: number,
    options: AITextOptions
): Promise<string> {
    let lastError: ProviderError | null = null;

    for (const model of models) {
        let response: Response;

        try {
            response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model,
                    max_tokens: options.maxOutputTokens,
                    temperature: options.temperature,
                    messages: [{
                        role: 'user',
                        content: options.prompt,
                    }],
                })
            }, timeoutMs);
        } catch (error) {
            lastError = toProviderError(`${provider} (${model})`, error);
            continue;
        }

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            lastError = new ProviderError(
                provider,
                response.status,
                RETRYABLE_STATUS_CODES.has(response.status),
                `${provider} API error (${model}): ${response.status} ${errorText.slice(0, 200)}`
            );
            continue;
        }

        const data = await response.json() as NvidiaNimResponse;
        const text = extractNvidiaNimText(data);
        if (!text) {
            lastError = new ProviderError(provider, response.status, true, `${provider} API (${model}) returned empty content`);
            continue;
        }

        return text;
    }

    throw lastError || new ProviderError(provider, null, true, `All ${provider} models failed`);
}

function generateWithNvidiaNim(options: AITextOptions): Promise<string> {
    const models = config.ai.nvidiaNimModels.length > 0
        ? config.ai.nvidiaNimModels
        : [config.ai.nvidiaNimModel];
    return generateWithOpenAICompat('NVIDIA NIM', config.ai.nvidiaNimUrl, config.ai.nvidiaNimKey, models, DEFAULT_TIMEOUT_MS, options);
}

function generateWithProxy(options: AITextOptions): Promise<string> {
    return generateWithOpenAICompat('LLM Proxy', config.ai.proxyUrl, config.ai.proxyKey, config.ai.proxyModels, PROXY_TIMEOUT_MS, options);
}

// ponytail: per-process circuit breaker; a provider that fails this many calls in a row
// is skipped for the rest of the run so one dead tier can't eat the job timeout.
const CIRCUIT_BREAK_AFTER = parsePositiveInt(process.env.SIDEQUEST_AI_CIRCUIT_BREAK_AFTER, 3);
const consecutiveFailures = new Map<string, number>();

export function hasAIProvider(): boolean {
    return Boolean(config.ai.proxyKey || config.ai.geminiKey || config.ai.nvidiaNimKey);
}

export async function generateTextWithFallback(options: AITextOptions): Promise<string> {
    // [name, enabled, run, attempts]. Gemini primary, Ollama (LLM proxy) fallback. Gemini and the
    // proxy get 1 attempt each: their key x model / model lists are already the retry.
    const tiers: Array<[string, boolean, () => Promise<string>, number]> = [
        ['Gemini', Boolean(config.ai.geminiKey), () => generateWithGemini(options), 1],
        ['LLM Proxy', Boolean(config.ai.proxyKey && config.ai.proxyModels.length), () => generateWithProxy(options), 1],
        ['NVIDIA NIM', Boolean(config.ai.nvidiaNimKey), () => generateWithNvidiaNim(options), DEFAULT_MAX_ATTEMPTS],
    ];
    const errors: string[] = [];

    for (const [name, enabled, run, attempts] of tiers) {
        if (!enabled) continue;
        const failures = consecutiveFailures.get(name) || 0;
        if (failures >= CIRCUIT_BREAK_AFTER) {
            errors.push(`${name}: circuit open after ${failures} consecutive failures`);
            continue;
        }
        try {
            const text = await runProviderWithRetries(name, options.taskLabel, run, attempts);
            consecutiveFailures.set(name, 0);
            return text;
        } catch (error) {
            consecutiveFailures.set(name, failures + 1);
            if (failures + 1 === CIRCUIT_BREAK_AFTER) {
                console.warn(`🔌 ${name} disabled for rest of run after ${CIRCUIT_BREAK_AFTER} consecutive failures`);
            }
            errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw new Error(
        errors.length > 0
            ? `All AI providers failed for ${options.taskLabel}: ${errors.join(' | ')}`
            : `No AI providers configured for ${options.taskLabel}`
    );
}
