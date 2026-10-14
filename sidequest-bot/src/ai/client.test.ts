import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEYS = 'dead,quota,good';
process.env.GEMINI_MODELS = 'm1,m2';
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_BACKUP_KEY_1;
delete process.env.GEMINI_BACKUP_KEY_2;
delete process.env.LLM_PROXY_API_KEY;
delete process.env.NIM_API_KEY;
delete process.env.NVIDIA_NIM_API_KEY;
delete process.env.NVIDIA_API_KEY;

const { generateTextWithFallback } = await import('./client.js');

type Call = { model: string; key: string };
function stubFetch(statusFor: (c: Call) => number): Call[] {
    const calls: Call[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
        const call = { model: url.split('/').pop()!.split(':')[0], key: (init.headers as Record<string, string>)['x-goog-api-key'] };
        calls.push(call);
        const status = statusFor(call);
        return status === 200
            ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `ok ${call.model}` }] }, finishReason: 'STOP' }] }))
            : new Response('{"error":{}}', { status });
    }) as typeof fetch;
    return calls;
}
const opts = { prompt: 'p', temperature: 0, maxOutputTokens: 10, taskLabel: 't' };

test('key errors fail over to the next key on the same model, from any rotation start', async () => {
    stubFetch(({ key }) => ({ dead: 403, quota: 429, good: 200 } as Record<string, number>)[key]);
    for (let i = 0; i < 3; i++) assert.equal(await generateTextWithFallback(opts), 'ok m1');
});

test('model overload skips to the next model instead of burning every key', async () => {
    const calls = stubFetch(({ model, key }) => (model === 'm1' ? 503 : key === 'dead' ? 403 : 200));
    assert.equal(await generateTextWithFallback(opts), 'ok m2');
    assert.equal(calls.filter((c) => c.model === 'm1').length, 1);
});
