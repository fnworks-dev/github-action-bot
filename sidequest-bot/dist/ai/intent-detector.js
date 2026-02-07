import { config } from '../config.js';
/**
 * Hiring intent detection using AI with keyword fallback.
 * Determines if a post is actually offering paid work or hiring.
 */
const INTENT_PROMPT = `You are a job intent detector. Your task is to determine if a post is offering paid work or hiring someone.

A post IS a job if it shows:
- Clear hiring language: "looking for [profession]", "hiring", "seeking", "need [profession]"
- Asking for paid work or tasks to be done
- Offering compensation, budget, or collaboration for work

A post is NOT a job if it:
- Seeks advice, opinions, or recommendations ("any recommendations?", "thoughts on?", "what do you think?")
- Discusses products, gear, or tools ("any love for X?", "experience with X?")
- Shares work for feedback ("just launched", "I released", "thoughts after", "lessons learned")
- Is casual conversation without hiring intent

POST TO ANALYZE:
Title: {title}
Content: {content}

Return ONLY valid JSON (no markdown):
{"isJob": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}`;
// ============================================================================
// KEYWORD-BASED INTENT DETECTION (Fast pre-filter)
// ============================================================================
/**
 * Quick keyword check for obvious hiring intent
 */
function keywordIntentCheck(title, content) {
    const text = `${title} ${content || ''}`.toLowerCase();
    // Positive hiring intent signals
    const positiveSignals = [
        'looking for',
        'hiring',
        'seeking',
        'need a',
        'need an',
        'need someone',
        'paid',
        'paying',
        'budget',
        'compensate',
        'for my project',
        'for my startup',
        'for my game',
        'for my app',
        'for my website',
        'wanted',
    ];
    // Negative signals (NOT hiring)
    const negativeSignals = [
        // Advice-seeking
        'any recommendations',
        'recommendations for',
        'thoughts on',
        'opinions on',
        'what do you think',
        'any advice',
        'help me decide',
        'i need some advice',
        'looking for advice',
        'need advice on',
        'looking for opinions',
        // Product discussions
        'any love for',
        'experience with',
        'thoughts about',
        // Post-mortems / feedback posts
        'just launched',
        'i released',
        'i created',
        'thoughts after',
        'observations after',
        'lessons learned',
        'feedback on my',
        'check out my',
        // Questions without hiring context
        'anyone else',
        'anyone use',
        'anyone using',
        'how do you',
        'how to',
    ];
    // Check negative signals first (they override positive)
    for (const signal of negativeSignals) {
        if (text.includes(signal)) {
            return {
                isJob: false,
                confidence: 0.85,
                reason: `Contains non-hiring pattern: "${signal}"`,
                method: 'keyword',
            };
        }
    }
    // Check positive signals
    let positiveCount = 0;
    const matchedSignals = [];
    for (const signal of positiveSignals) {
        if (text.includes(signal)) {
            positiveCount++;
            matchedSignals.push(signal);
        }
    }
    if (positiveCount >= 1) {
        return {
            isJob: true,
            confidence: Math.min(0.95, 0.7 + (positiveCount * 0.1)),
            reason: `Contains hiring pattern(s): ${matchedSignals.slice(0, 2).join(', ')}`,
            method: 'keyword',
        };
    }
    // No clear signals - let AI decide
    return {
        isJob: false,
        confidence: 0.3,
        reason: 'No clear hiring intent detected',
        method: 'keyword',
    };
}
// ============================================================================
// AI-BASED INTENT DETECTION
// ============================================================================
/**
 * Call Gemini API for intent detection
 */
async function detectIntentWithGemini(title, content) {
    const prompt = INTENT_PROMPT
        .replace('{title}', title)
        .replace('{content}', content || '(no content)');
    const response = await fetch(`${config.ai.geminiUrl}?key=${config.ai.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                    parts: [{ text: prompt }]
                }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 300,
            }
        })
    });
    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }
    const data = await response.json();
    const content_text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    // Parse AI response
    const cleaned = content_text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
        isJob: parsed.isJob,
        confidence: parsed.confidence,
        reason: parsed.reason,
        method: 'ai',
    };
}
/**
 * Call GLM API for intent detection (Anthropic-compatible format)
 */
async function detectIntentWithGLM(title, content) {
    const prompt = INTENT_PROMPT
        .replace('{title}', title)
        .replace('{content}', content || '(no content)');
    const response = await fetch(config.ai.glmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.ai.glmKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', // Maps to GLM-4 via Z.ai proxy
            max_tokens: 300,
            messages: [{
                    role: 'user',
                    content: prompt
                }]
        })
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.log(`   GLM error ${response.status}: ${errorText.slice(0, 100)}`);
        throw new Error(`GLM API error: ${response.status}`);
    }
    const data = await response.json();
    const content_text = data.content?.[0]?.text || '{}';
    // Parse AI response
    const cleaned = content_text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
        isJob: parsed.isJob,
        confidence: parsed.confidence,
        reason: parsed.reason,
        method: 'ai',
    };
}
// ============================================================================
// MAIN INTENT DETECTION FUNCTION
// ============================================================================
/**
 * Detect hiring intent using hybrid approach:
 * 1. Keyword check for obvious patterns
 * 2. AI verification for unclear cases
 */
export async function detectHiringIntent(title, content) {
    const text = `${title}\n\n${content || ''}`.trim();
    // If text is too short, use keyword matching only
    if (text.length < 50) {
        console.log('📝 Post too short, using keyword intent detection');
        return keywordIntentCheck(title, content);
    }
    // Step 1: Quick keyword check
    const keywordResult = keywordIntentCheck(title, content);
    // High confidence keyword match - use it directly
    if (keywordResult.confidence >= 0.85) {
        return keywordResult;
    }
    // Step 2: AI verification for unclear cases
    // Try Gemini first
    if (config.ai.geminiKey) {
        try {
            console.log('🤖 Using Gemini AI for intent detection');
            return await detectIntentWithGemini(title, content);
        }
        catch (error) {
            console.warn('⚠️ Gemini intent detection failed, falling back to keywords:', error);
        }
    }
    // Try GLM as fallback
    if (config.ai.glmKey) {
        try {
            console.log('🤖 Using GLM AI for intent detection');
            return await detectIntentWithGLM(title, content);
        }
        catch (error) {
            console.warn('⚠️ GLM intent detection failed, falling back to keywords:', error);
        }
    }
    // Final fallback to keyword matching
    console.log('🔍 Using keyword-based intent detection');
    return keywordResult;
}
/**
 * Filter posts array to only those with hiring intent
 */
export async function filterByHiringIntent(posts) {
    const jobPosts = [];
    for (const post of posts) {
        try {
            const result = await detectHiringIntent(post.title, post.content);
            if (result.isJob) {
                jobPosts.push(post);
                console.log(`  ✅ Job intent: ${post.title.slice(0, 40)}... (${result.reason})`);
            }
            else {
                console.log(`  ❌ Not a job: ${post.title.slice(0, 40)}... (${result.reason})`);
            }
        }
        catch (error) {
            console.error(`Failed to detect intent for post: ${post.title.slice(0, 30)}...`, error);
            // On error, exclude the post to be safe
        }
    }
    return jobPosts;
}
