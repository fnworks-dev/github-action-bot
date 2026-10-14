import { config } from "../config.js";

// Errors tied to one key/project (bad or blocked key, quota): the next key can still succeed.
// Anything else (503 overload, timeout) hits every key, so move to the next model.
// Same rules as sidequest-bot, research-bot and the app's AI replies.
export function isKeySpecificError(status: number, body: string): boolean {
    return status === 401 || status === 403 || status === 429 || body.includes("API_KEY_INVALID");
}

let geminiKeyCursor = 0;

// Gemini key pool x model chain. Starting key rotates per call so usage spreads across projects.
export async function generateWithGemini(
    prompt: string,
    generationConfig: { temperature: number; maxOutputTokens: number },
): Promise<string> {
    const keys = config.ai.geminiKeys;
    if (!keys.length) throw new Error("Gemini: no keys configured");
    const start = geminiKeyCursor++ % keys.length;
    const rotated = [...keys.slice(start), ...keys.slice(0, start)];
    let lastError = "no models";

    for (const model of config.ai.geminiModels) {
        for (const [i, key] of rotated.entries()) {
            const label = `${model} key …${key.slice(-4)} (${i + 1}/${rotated.length})`;
            let response: Response;
            try {
                response = await fetch(`${config.ai.geminiBaseUrl}/${model}:generateContent`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
                    signal: AbortSignal.timeout(30_000),
                });
            } catch (error: any) {
                lastError = `${label}: ${error.name === "TimeoutError" ? "timeout" : error.message}`;
                break;
            }

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                lastError = `${label}: ${response.status} ${errorText.slice(0, 120)}`;
                console.log(`   Gemini error ${lastError}`);
                if (isKeySpecificError(response.status, errorText)) continue;
                break;
            }

            const data: any = await response.json();
            const text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
            if (text) return text;
            lastError = `${label}: empty content`;
            break;
        }
    }
    throw new Error(`Gemini API error: ${lastError}`);
}
