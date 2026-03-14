import type { IntentDetectionResult, RawPost } from '../types.js';
import { config } from '../config.js';
import { generateTextWithFallback } from './client.js';

/**
 * Hiring intent detection using AI with keyword fallback.
 * Determines if a post is actually offering paid work or hiring.
 */

const INTENT_PROMPT = `You are a STRICT job intent detector. Be AGGRESSIVE in rejecting non-job posts. Your task is to determine if a post is TRULY offering paid work or hiring someone for a specific task/project.

A post IS a job ONLY if it shows ALL of these:
- Clear hiring intent: "looking for [profession]", "hiring", "seeking", "need [profession]" to DO WORK
- Specific work to be done (build X, design Y, write Z)
- The poster is the employer/client, not selling something

A post is NOT a job (REJECT these aggressively):
- Seeks advice, recommendations, tips, or opinions ("need advice on", "recommendations?", "thoughts on?", "struggling with", "how do I")
- Looking to SELL/TRANSFER something ("handover my", "sell my SaaS", "looking for buyer")
- Commission/sales schemes ("earn ₹", "earn $", "% commission", "for every business you close")
- Navigation spam ("go to r/", "check out r/", "post this in", "wrong sub")
- Empty/low effort (title only "[Hiring]" with no content)
- Vague "looking for" without clear job context ("looking for packaging" - packaging of what?)
- MLM, referral programs, affiliate marketing
- Casual conversation, surveys, or feedback requests

POST TO ANALYZE:
Title: {title}
Content: {content}

Return ONLY valid JSON (no markdown):
{"isJob": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

interface AIResponse {
    isJob: boolean;
    confidence: number;
    reason: string;
}

// ============================================================================
// KEYWORD-BASED INTENT DETECTION (Fast pre-filter)
// ============================================================================

/**
 * Quick keyword check for obvious hiring intent
 */
function keywordIntentCheck(title: string, content: string | null): IntentDetectionResult {
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

    // Negative signals (NOT hiring) - TIGHTENED
    const negativeSignals = [
        // Advice-seeking (EXPANDED)
        'any recommendations',
        'recommendations for',
        'recommendations pls',
        'recommendations please',
        'thoughts on',
        'opinions on',
        'what do you think',
        'any advice',
        'any advise',
        'need advise',
        'need advice',
        'help me decide',
        'i need some advice',
        'looking for advice',
        'looking for advise',
        'need advice on',
        'need advise on',
        'looking for opinions',
        'struggling with',
        'struggling to',
        'suggestions for',
        'suggestions on',
        'guide me',
        'tips for',
        'looking for tips',
        'looking for guidance',
        
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
        
        // Sales/Commission schemes (TIGHTENED to avoid art "commission" false positives)
        'earn ₹',
        'earn rs',
        '% commission',           // NOT just "commission" - art world uses "commission" for custom work
        'percent commission',
        'for every business you close',
        'for every sale',
        'for every referral',
        'referral program',
        'affiliate program',
        'mlm',
        'multi-level',
        'passive income',
        'make money online',
        'side hustle',
        
        // Selling/Transferring (NOT hiring) (NEW)
        'handover my',
        'hand over my',
        'sell my',
        'selling my',
        'transfer my',
        'looking for buyer',
        'looking for someone to buy',
        
        // Navigation spam (NEW)
        'go to r/',
        'check out r/',
        'try r/',
        'post this in',
        'wrong sub',
        'wrong subreddit',
        'go to smallbusiness',
        'check out smallbusiness',
        
        // Empty/low effort (NEW)
        '[hiring] ->',
        '[hiring] -',
        
        // Vague "looking for" without context (NEW)
        'looking for packaging',
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
    const matchedSignals: string[] = [];
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

async function detectIntentWithAI(title: string, content: string | null): Promise<IntentDetectionResult> {
    const prompt = INTENT_PROMPT
        .replace('{title}', title)
        .replace('{content}', content || '(no content)');

    const contentText = await generateTextWithFallback({
        prompt,
        temperature: 0.1,
        maxOutputTokens: 300,
        taskLabel: 'intent detection',
    });
    const cleaned = contentText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as AIResponse;

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
export async function detectHiringIntent(
    title: string,
    content: string | null
): Promise<IntentDetectionResult> {
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
    if (config.ai.geminiKey || config.ai.nvidiaNimKey) {
        try {
            return await detectIntentWithAI(title, content);
        } catch (error) {
            console.warn('⚠️ AI intent detection failed, falling back to keywords:', error);
        }
    }

    // Final fallback to keyword matching
    console.log('🔍 Using keyword-based intent detection');
    return keywordResult;
}

/**
 * Filter posts array to only those with hiring intent
 */
export async function filterByHiringIntent(
    posts: RawPost[]
): Promise<RawPost[]> {
    const jobPosts: RawPost[] = [];

    for (const post of posts) {
        try {
            const result = await detectHiringIntent(post.title, post.content);

            if (result.isJob) {
                jobPosts.push(post);
                console.log(`  ✅ Job intent: ${post.title.slice(0, 40)}... (${result.reason})`);
            } else {
                console.log(`  ❌ Not a job: ${post.title.slice(0, 40)}... (${result.reason})`);
            }
        } catch (error) {
            console.error(`Failed to detect intent for post: ${post.title.slice(0, 30)}...`, error);
            // On error, exclude the post to be safe
        }
    }

    return jobPosts;
}
