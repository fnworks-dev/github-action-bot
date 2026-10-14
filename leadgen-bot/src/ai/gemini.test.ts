import { describe, expect, it, vi } from "vitest";

describe("generateWithGemini key pool", () => {
    it("fails over on key errors and skips to the next model on overload", async () => {
        vi.stubEnv("GEMINI_API_KEYS", "dead,quota,good");
        vi.stubEnv("GEMINI_MODELS", "m1,m2");
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("GEMINI_BACKUP_KEY_1", "");
        vi.stubEnv("GEMINI_BACKUP_KEY_2", "");
        const { generateWithGemini } = await import("./gemini.js");
        const cfg = { temperature: 0, maxOutputTokens: 10 };

        let statusFor = (model: string, key: string) => ({ dead: 403, quota: 429, good: 200 } as Record<string, number>)[key];
        const calls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
            const model = url.split("/").pop()!.split(":")[0];
            const key = init.headers["x-goog-api-key"];
            calls.push(`${model}:${key}`);
            const status = statusFor(model, key);
            return status === 200
                ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `ok ${model}` }] } }] }))
                : new Response("{}", { status });
        }));

        for (let i = 0; i < 3; i++) expect(await generateWithGemini("p", cfg)).toBe("ok m1");

        statusFor = (model, key) => (model === "m1" ? 503 : key === "dead" ? 403 : 200);
        calls.length = 0;
        expect(await generateWithGemini("p", cfg)).toBe("ok m2");
        expect(calls.filter((c) => c.startsWith("m1:"))).toHaveLength(1);
    });
});
