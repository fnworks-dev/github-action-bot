/**
 * Single-call job scorer: intent + professions + summary + analysis + quality score.
 * Replaces the old 4-call chain (intent, categorize, summary, analyze) per post.
 * Score semantics match sidequestboard-job-fetcher (twitter/discord) so Reddit
 * rows rank on the same scale: score 1-10, match_score 0-100.
 */

import type { JobAnalysis, Profession, RawPost } from '../types.js';
import { generateTextWithFallback, hasAIProvider } from './client.js';
import { categorizeWithKeywords, heuristicSummary } from './categorizer.js';
import { keywordIntentCheck } from './intent-detector.js';

export interface JobScore {
    isJob: boolean;
    professions: Profession[];
    confidence: number;
    summary: string;
    analysis: JobAnalysis;
    score: number;       // 1-10
    matchScore: number;  // 0-100
    method: 'ai' | 'keyword';
    reason: string;
}

const VALID_PROFESSIONS: Profession[] = [
    'developer', 'artist', 'voice-actor', 'video-editor',
    'writer', 'audio', 'qa', 'virtual-assistant',
];

const PROMPT = `You score Reddit posts for SideQuest Board, a board of PAID freelance gigs.

Professions:
- developer: software/web/app/game programming
- artist: illustration, character art, commissions, graphic/logo design, UI/UX, concept art, 2D/3D, pixel art
- voice-actor: voice over, narration, dubbing
- video-editor: video editing, motion graphics, animation, VFX
- writer: copywriting, content, technical, script writing
- audio: sound design, music, mixing
- qa: testing, QA
- virtual-assistant: admin, scheduling, data entry

POST (r/{subreddit}):
Title: {title}
Content: {content}

Decide:
1. isJob: true ONLY if the poster is HIRING/paying someone for specific work.
   false for: people offering their own services ([For Hire], [FH], "commissions open", portfolios),
   advice/questions, showcases, selling things, cofounder/partner hunts, surveys, MLM/commission sales.
2. score 1-10, judged as a freelancer deciding whether to apply:
   9-10: explicit fair pay (amount or rate), clear deliverables (what, how many, style/refs), timeline or contact method.
   7-8: paid with clear work, a detail or two missing.
   5-6: paid but vague, or pay "negotiable"/"DM for budget".
   3-4: lowball pay (e.g. $5-20 for a full illustration or logo), spec work/contests, "exposure", revenue share, equity only, heavy red flags.
   1-2: not a real job, unpaid, scam, spam, adult/NSFW, or written in / mixing in sentences or phrases of another language (Indonesian, Spanish, Tagalog, ...). We only list English posts; a lone greeting ("Hola!") or foreign names are fine.
   Art-specific: reward reference images, usage rights, size/count of pieces, realistic budget. Penalise "art trade", "portfolio piece", "free test piece", "AI art fix for cheap".
3. match_score 0-100: overall rank value (roughly score*10, adjust within the band for detail quality).

Return ONLY JSON, no markdown:
{"isJob":true,"professions":["artist"],"confidence":0.9,"score":7,"match_score":72,
"summary":"1-2 plain sentences: what they need and pay",
"project_type":"Character illustration" or null,
"tech_stack":["Procreate"] or [],
"scope":"small"|"medium"|"large"|null,
"timeline_signal":"ASAP" or null,
"budget_signal":"$60 per portrait" or null,
"red_flags":[],"green_flags":[],
"reason":"short why"}`;

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
    const v = typeof n === 'number' ? n : Number(n);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

function strList(v: unknown, max = 8): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max) : [];
}

function nullableStr(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t && !/^(null|none|not mentioned|n\/a|unknown)$/i.test(t) ? t : null;
}

function extractJson(text: string): Record<string, unknown> {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error(`No JSON object in model output: ${cleaned.slice(0, 120)}`);
    return JSON.parse(cleaned.slice(start, end + 1));
}

export function parseScore(raw: string, post: RawPost): JobScore {
    const p = extractJson(raw);
    const professions = strList(p.professions).filter((x): x is Profession =>
        VALID_PROFESSIONS.includes(x as Profession));
    const score = clamp(p.score, 1, 10, 5);
    const scope = typeof p.scope === 'string' && ['small', 'medium', 'large'].includes(p.scope)
        ? p.scope as JobAnalysis['scope'] : null;
    const summary = nullableStr(p.summary) || heuristicSummary(post.title, post.content) || post.title;
    return {
        isJob: p.isJob === true,
        professions,
        confidence: clamp(Number(p.confidence) * 100, 0, 100, 70) / 100,
        summary: summary.split(/\s+/).slice(0, 100).join(' '),
        analysis: {
            project_type: nullableStr(p.project_type),
            tech_stack: strList(p.tech_stack, 5),
            scope,
            timeline_signal: nullableStr(p.timeline_signal),
            budget_signal: nullableStr(p.budget_signal),
            red_flags: strList(p.red_flags),
            green_flags: strList(p.green_flags),
        },
        score,
        matchScore: clamp(p.match_score, 0, 100, score * 10),
        method: 'ai',
        reason: nullableStr(p.reason) || '',
    };
}

const PAY_RE = /(\$\s?\d|\d+\s?(usd|eur|gbp|€|£)|\/\s?(hr|hour)|per (hour|piece|image|page|word)|budget|paid|paying)/i;
const LOWVALUE_RE = /\b(unpaid|exposure|rev(enue)?[\s-]?share|equity only|art trade|portfolio piece|free test|volunteer)\b/i;

/** Deterministic fallback so a row never lands with a null score when every AI tier is down. */
export function keywordScore(post: RawPost): JobScore {
    const text = `${post.title}\n${post.content || ''}`;
    const intent = keywordIntentCheck(post.title, post.content);
    const cat = categorizeWithKeywords(post.title, post.content);
    let score = 5;
    if (PAY_RE.test(text)) score += 2;
    if ((post.content || '').length > 300) score += 1;
    if (LOWVALUE_RE.test(text)) score -= 3;
    score = Math.min(8, Math.max(1, score)); // ponytail: heuristic capped at 8; AI owns the top band
    return {
        isJob: intent.isJob,
        professions: cat.professions,
        confidence: cat.confidence,
        summary: heuristicSummary(post.title, post.content) || post.title,
        analysis: {
            project_type: null, tech_stack: [], scope: null, timeline_signal: null,
            budget_signal: null, red_flags: LOWVALUE_RE.test(text) ? ['unpaid / low-value compensation'] : [],
            green_flags: PAY_RE.test(text) ? ['pay mentioned'] : [],
        },
        score,
        matchScore: score * 10,
        method: 'keyword',
        reason: intent.reason || 'keyword fallback',
    };
}

export async function scoreJob(post: RawPost): Promise<JobScore> {
    if (hasAIProvider()) {
        const prompt = PROMPT
            .replace('{subreddit}', post.subreddit || 'unknown')
            .replace('{title}', post.title)
            .replace('{content}', (post.content || '(no content)').slice(0, 6000));
        try {
            const raw = await generateTextWithFallback({
                prompt,
                temperature: 0.1,
                maxOutputTokens: 2048, // reasoning models spend budget on thinking; keep headroom
                taskLabel: 'job scoring',
            });
            return parseScore(raw, post);
        } catch (error) {
            console.warn(`⚠️ AI scoring failed, keyword fallback: ${error instanceof Error ? error.message : error}`);
        }
    }
    return keywordScore(post);
}
