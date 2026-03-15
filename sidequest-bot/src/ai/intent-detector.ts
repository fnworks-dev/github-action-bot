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

function keywordIntentCheck(title: string, content: string | null): IntentDetectionResult {
    const text = `${title} ${content || ''}`.toLowerCase();

    const positiveSignals = [
        // Hiring verbs (strong)
        '[hiring]',
        'hiring',
        'seeking',
        'need someone',
        'need a',
        'need an',
        // Weak by itself; treated as strong only when paired with role tokens
        'looking for',
        // Pay/budget indicators
        'paid',
        'paying',
        'budget',
        'compensate',
        '$',
        'usd',
        '/hr',
        'per hour',
    ];

    const negativeSignals = [
        // "Looking for ..." but clearly not hiring (seeking a product/tool/advice, not labor)
        'looking for an app',
        'looking for a tool',
        'looking for a software',
        'looking for software',
        'looking for a platform',
        'looking for a service',
        'looking for a solution',
        'looking for a crm',
        'looking for a saas',
        'looking for a template',
        'looking for resources',
        'looking for resource',
        // Partnership / cofounder posts are not freelance jobs
        'looking for cofounder',
        'looking for a cofounder',
        'looking for co-founder',
        'looking for a co-founder',
        'seeking cofounder',
        'seeking a cofounder',
        'seeking co-founder',
        'seeking a co-founder',
        'cofounder wanted',
        'co-founder wanted',
        'technical cofounder',
        'technical co-founder',
        'cto cofounder',
        'cto co-founder',
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
        'any love for',
        'experience with',
        'thoughts about',
        'just launched',
        'i released',
        'i created',
        'i built',
        'i made',
        'i shipped',
        'i open-sourced',
        'i open sourced',
        'open-sourced',
        'open sourced',
        'unpopular opinion',
        'hot take',
        'my saas',
        'my startup',
        'my product',
        'my app',
        'my software',
        'built a tool',
        'built an app',
        'built a',
        'built an',
        'how i ',
        'how we ',
        'thoughts after',
        'observations after',
        'lessons learned',
        'feedback on my',
        'check out my',
        'anyone else',
        'anyone use',
        'anyone using',
        'how do you',
        'how to',
        'what would you do',
        'earn ₹',
        'earn rs',
        '% commission',
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
        'handover my',
        'hand over my',
        'sell my',
        'selling my',
        'transfer my',
        'looking for buyer',
        'looking for someone to buy',
        'go to r/',
        'check out r/',
        'try r/',
        'post this in',
        'wrong sub',
        'wrong subreddit',
        'go to smallbusiness',
        'check out smallbusiness',
        '[hiring] ->',
        '[hiring] -',
        'looking for packaging',
    ];

    const roleTokens = [
        'developer',
        'programmer',
        'engineer',
        'designer',
        'artist',
        'illustrator',
        'writer',
        'copywriter',
        'video editor',
        'editor',
        'voice actor',
        'voice actress',
        'voiceover',
        'va',
        'virtual assistant',
        'tester',
        'qa',
        'sound designer',
        'audio engineer',
        'composer',
    ];

    function hasRoleRequest(): boolean {
        for (const role of roleTokens) {
            const patterns = [
                `looking for ${role}`,
                `looking for a ${role}`,
                `looking for an ${role}`,
                `need ${role}`,
                `need a ${role}`,
                `need an ${role}`,
                `hiring ${role}`,
                `hiring a ${role}`,
                `hiring an ${role}`,
                `seeking ${role}`,
                `seeking a ${role}`,
                `seeking an ${role}`,
                `${role} needed`,
                `${role} required`,
            ];

            for (const p of patterns) {
                if (text.includes(p)) return true;
            }
        }
        return false;
    }

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

    let positiveCount = 0;
    const matchedSignals: string[] = [];
    for (const signal of positiveSignals) {
        if (text.includes(signal)) {
            positiveCount++;
            matchedSignals.push(signal);
        }
    }

    const hasStrongHiringVerb =
        text.includes('[hiring]') ||
        text.includes('hiring') ||
        text.includes('seeking') ||
        text.includes('need someone') ||
        text.includes('need a') ||
        text.includes('need an');
    const hasPaySignal =
        text.includes('paid') ||
        text.includes('paying') ||
        text.includes('budget') ||
        text.includes('compensate') ||
        text.includes('$') ||
        text.includes(' usd') ||
        text.includes('/hr') ||
        text.includes(' per hour');
    const hasExplicitRole = hasRoleRequest();

    const hasHiringForSomeoneToDoWork =
        text.includes('looking for someone to') ||
        text.includes('looking for somebody to') ||
        text.includes('seeking someone to') ||
        text.includes('hiring someone to') ||
        text.includes('need someone to') ||
        text.includes('need somebody to');

    // Self-promo/showcase posts (e.g. "I built...", "How I...", "Unpopular opinion...") without any hiring verb/role.
    const hasSelfPromo =
        text.includes('i built') ||
        text.includes('i made') ||
        text.includes('i open-sourced') ||
        text.includes('i open sourced') ||
        text.includes('unpopular opinion') ||
        text.includes('hot take') ||
        text.includes('how i ') ||
        text.includes('how we ') ||
        text.includes('my saas') ||
        text.includes('my startup') ||
        text.includes('my product') ||
        text.includes('my app') ||
        text.includes('my software');
    if (hasSelfPromo && !hasStrongHiringVerb && !hasExplicitRole) {
        return {
            isJob: false,
            confidence: 0.9,
            reason: 'Self-promo/showcase post (not hiring)',
            method: 'keyword',
        };
    }

    if (hasStrongHiringVerb && (hasPaySignal || hasExplicitRole)) {
        return {
            isJob: true,
            confidence: 0.9,
            reason: hasPaySignal
                ? 'Contains explicit hiring + pay/budget signal'
                : 'Contains explicit hiring + role requested',
            method: 'keyword',
        };
    }

    if ((hasStrongHiringVerb || text.includes('looking for')) && hasHiringForSomeoneToDoWork) {
        return {
            isJob: true,
            confidence: 0.75,
            reason: 'Contains "looking for/need someone to <do work>" pattern (needs AI verification)',
            method: 'keyword',
        };
    }

    // "Looking for" is extremely ambiguous; only treat it as hiring when paired with a role token.
    if (text.includes('looking for') && hasExplicitRole) {
        return {
            isJob: true,
            confidence: 0.75,
            reason: 'Contains "looking for <role>" pattern (needs AI verification)',
            method: 'keyword',
        };
    }

    // If there's literally no hiring signal at all, treat it as a high-confidence NOT-a-job.
    // This prevents the AI layer from "hallucinating" hiring intent for generic r/SaaS/r/Entrepreneur posts.
    if (!hasStrongHiringVerb && !hasExplicitRole && !hasPaySignal && positiveCount === 0) {
        return {
            isJob: false,
            confidence: 0.9,
            reason: 'No hiring signals detected (generic discussion/self-promo/etc.)',
            method: 'keyword',
        };
    }

    return {
        isJob: false,
        confidence: 0.3,
        reason: 'No clear hiring intent detected (ambiguous)',
        method: 'keyword',
    };
}

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

export async function detectHiringIntent(title: string, content: string | null): Promise<IntentDetectionResult> {
    const text = `${title}\n\n${content || ''}`.trim();

    if (text.length < 50) {
        console.log('📝 Post too short, using keyword intent detection');
        return keywordIntentCheck(title, content);
    }

    const keywordResult = keywordIntentCheck(title, content);
    if (keywordResult.confidence >= 0.85) {
        return keywordResult;
    }

    if (config.ai.geminiKey || config.ai.nvidiaNimKey) {
        try {
            return await detectIntentWithAI(title, content);
        } catch (error) {
            console.warn('⚠️ AI intent detection failed, falling back to keywords:', error);
        }
    }

    console.log('🔍 Using keyword-based intent detection');
    return keywordResult;
}

export async function filterByHiringIntent(posts: RawPost[]): Promise<RawPost[]> {
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
        }
    }

    return jobPosts;
}
