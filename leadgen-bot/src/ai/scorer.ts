import { config } from '../config.js';
import type { RawPost, ScoringResult } from '../types.js';

const SCORING_PROMPT = `You are a lead scoring assistant for a web development agency called FNworks.

FNworks specializes in:
- AI integration (GPT-4, Claude, custom AI features)
- Web development (React, Next.js, TypeScript)
- Interactive experiences (3D, data visualization)
- Custom dashboards and SaaS platforms

Target clients: Non-technical founders with $10K-$50K+ budgets who need MVPs built quickly.

Analyze the following post and provide a JSON response with:
1. "score": 1-10 rating (10 = perfect lead, 1 = not relevant)
2. "summary": 1-2 sentence summary of what they need

Scoring criteria:
- 8-10: Clear budget signals, needs web dev, urgent timeline, funded startup
- 6-7: Needs developer, seems serious, unclear budget
- 4-5: Vague request, might just be exploring
- 1-3: Not relevant, already solved, spam, or not looking for developers

EXCLUDE (score 1-3) - Not developer work:
- Video editing, clipping, content creation, "clipper"
- Surveys, studies, research participants
- Game testing, "test games"
- Simple microtasks, data entry
- Sales, telemarketing, call closing
- Social media management, Reddit posting/commenting
- Watching content for pay (sports, videos)
- Transcription, virtual assistant, customer support

POST:
Title: {title}
Content: {content}
Source: {source}

Respond ONLY with valid JSON, no markdown:`;

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

// Keyword-based fallback scoring (when AI fails)
function keywordScore(post: RawPost): ScoringResult {
    const text = `${post.title} ${post.content || ''}`.toLowerCase();

    let score = 4; // Base score
    let reasons: string[] = [];

    // High-intent signals (+2 each, max 2)
    const highIntent = [
        { pattern: 'looking for developer', reason: 'Looking for developer' },
        { pattern: 'hiring developer', reason: 'Hiring' },
        { pattern: 'need developer', reason: 'Needs developer' },
        { pattern: 'technical cofounder', reason: 'Seeking cofounder' },
        { pattern: 'tech co-founder', reason: 'Seeking cofounder' },
    ];

    let highMatches = 0;
    for (const hi of highIntent) {
        if (text.includes(hi.pattern) && highMatches < 2) {
            score += 2;
            reasons.push(hi.reason);
            highMatches++;
        }
    }

    // Budget signals (+1 each)
    const budgetSignals = ['budget', 'pay', 'paying', 'funded', 'investment', '$', 'equity'];
    for (const signal of budgetSignals) {
        if (text.includes(signal)) {
            score += 1;
            reasons.push('Budget mentioned');
            break;
        }
    }

    // Urgency signals (+1)
    const urgencySignals = ['asap', 'urgent', 'quickly', 'fast', 'deadline', 'this week', 'this month'];
    for (const signal of urgencySignals) {
        if (text.includes(signal)) {
            score += 1;
            reasons.push('Urgent');
            break;
        }
    }

    // Negative signals for non-developer jobs (-3 to -5 points)
    const nonDevJobs = [
        // Video editing, clipping, content creation
        { pattern: 'clipping', penalty: 4, reason: 'Video clipping' },
        { pattern: 'clipper', penalty: 4, reason: 'Video clipping' },
        { pattern: 'video editor', penalty: 4, reason: 'Video editing' },
        { pattern: 'content creator', penalty: 3, reason: 'Content creation' },
        { pattern: 'youtuber', penalty: 3, reason: 'YouTube content' },
        { pattern: 'edit video', penalty: 4, reason: 'Video editing' },

        // Surveys, studies, research participants
        { pattern: 'survey', penalty: 4, reason: 'Survey/Research' },
        { pattern: 'study participant', penalty: 4, reason: 'Study participant' },
        { pattern: 'user testing', penalty: 3, reason: 'User testing' },
        { pattern: 'test games', penalty: 4, reason: 'Game testing' },

        // Simple microtasks
        { pattern: 'simple tasks', penalty: 4, reason: 'Simple tasks' },
        { pattern: 'microtasks', penalty: 4, reason: 'Microtasks' },
        { pattern: '$4 per task', penalty: 5, reason: 'Microtask pricing' },
        { pattern: 'quick task', penalty: 3, reason: 'Quick tasks' },

        // Sales, telemarketing
        { pattern: 'sales representative', penalty: 4, reason: 'Sales role' },
        { pattern: 'telemarketing', penalty: 4, reason: 'Telemarketing' },
        { pattern: 'call closing', penalty: 4, reason: 'Sales calls' },
        { pattern: 'sales call', penalty: 4, reason: 'Sales calls' },

        // Data entry, transcription
        { pattern: 'data entry', penalty: 4, reason: 'Data entry' },
        { pattern: 'transcription', penalty: 4, reason: 'Transcription' },
        { pattern: 'transcribe', penalty: 4, reason: 'Transcription' },

        // Social media management
        { pattern: 'social media manager', penalty: 3, reason: 'Social media' },
        { pattern: 'reddit post', penalty: 4, reason: 'Reddit posting' },
        { pattern: 'reddit comment', penalty: 4, reason: 'Reddit commenting' },
        { pattern: 'reddit account', penalty: 4, reason: 'Reddit account' },

        // Watching content for pay
        { pattern: 'watch basketball', penalty: 5, reason: 'Watching content' },
        { pattern: 'watch videos', penalty: 4, reason: 'Watching videos' },
        { pattern: 'get paid to watch', penalty: 5, reason: 'Watching content' },

        // Other non-dev roles
        { pattern: 'virtual assistant', penalty: 3, reason: 'Virtual assistant' },
        { pattern: 'customer support', penalty: 3, reason: 'Customer support' },
        { pattern: 'game tester', penalty: 4, reason: 'Game testing' },

        // Self-promotion / developer posts
        { pattern: '[for hire]', penalty: 5, reason: 'For hire post' },
        { pattern: 'i am a developer', penalty: 5, reason: 'Developer self-post' },
        { pattern: 'i built', penalty: 3, reason: 'Self-promotion' },
        { pattern: 'just launched', penalty: 3, reason: 'Self-promotion' },
    ];

    for (const job of nonDevJobs) {
        if (text.includes(job.pattern)) {
            score -= job.penalty;
            reasons.push(job.reason);
            break; // Only apply the first match to avoid over-penalizing
        }
    }

    score = Math.max(1, Math.min(10, score));
    const summary = reasons.length > 0
        ? `Keyword match: ${reasons.slice(0, 2).join(', ')}`
        : 'General inquiry';

    return {
        score,
        summary: `[Auto-scored] ${summary}`,
        suggestedReply: '',
        shouldNotify: score >= config.minScoreThreshold,
    };
}

// Score with retry
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

// Score using Gemini
async function scoreWithGemini(prompt: string): Promise<string> {
    const url = `${config.ai.geminiUrl}?key=${config.ai.geminiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 500,
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

// Score using GLM (via Anthropic-compatible endpoint for GLM Coding Plan)
async function scoreWithGLM(prompt: string): Promise<string> {
    const response = await fetch(config.ai.glmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.ai.glmKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', // Maps to GLM-4.7 via Z.ai proxy
            max_tokens: 500,
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

export async function scorePost(post: RawPost): Promise<ScoringResult> {
    const prompt = SCORING_PROMPT
        .replace('{title}', post.title)
        .replace('{content}', post.content || '(no content)')
        .replace('{source}', post.subreddit || post.source);

    try {
        let content: string = '';

        // Try GLM first (primary - using Anthropic-compatible endpoint)
        if (config.ai.glmKey) {
            try {
                content = await callWithRetry(() => scoreWithGLM(prompt), 'GLM', 2);
            } catch (glmError: any) {
                console.log(`   ⚠️ GLM failed: ${glmError.message}`);
            }
        }

        // Fallback to Gemini
        if (!content && config.ai.geminiKey) {
            try {
                content = await callWithRetry(() => scoreWithGemini(prompt), 'Gemini', 2);
            } catch (geminiError: any) {
                console.log(`   ⚠️ Gemini failed: ${geminiError.message}`);
            }
        }

        // If both AI failed, use keyword scoring
        if (!content) {
            console.log('   📊 Using keyword-based scoring (AI unavailable)');
            return keywordScore(post);
        }

        // Parse JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.log('   ⚠️ No JSON in AI response, using keyword scoring');
            return keywordScore(post);
        }

        const result = JSON.parse(jsonMatch[0]);

        return {
            score: Math.min(10, Math.max(1, parseInt(result.score, 10) || 5)),
            summary: result.summary || 'Unable to summarize',
            suggestedReply: '',
            shouldNotify: (result.score || 5) >= config.minScoreThreshold,
        };
    } catch (error: any) {
        console.error('AI scoring error:', error.message);
        // Fallback to keyword scoring instead of returning error
        console.log('   📊 Fallback to keyword scoring');
        return keywordScore(post);
    }
}
