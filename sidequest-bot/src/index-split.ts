#!/usr/bin/env node
/**
 * SideQuest Bot - Split Config Version
 * Usage: CONFIG=01 npm start
 * 
 * Uses Arctic Shift API as the configured Reddit data source.
 */

import { createClient } from '@libsql/client';
import type { RawPost, Profession, SidequestRunStage } from './types.js';

const CONFIG_NUM = process.env.CONFIG || '01';

// Dynamically import the correct config
const configModule = await import(`./configs/config-${CONFIG_NUM}.js`);
const { config, validateConfig, getAllSubreddits, shouldFilterPost } = configModule;
const professions = configModule.professions;

// Import other modules
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { keywordIntentCheck } from './ai/intent-detector.js';
import { scoreJob } from './ai/scorer.js';
import { loadRejected, saveRejected } from './rejected-cache.js';
import type { JobScore } from './ai/scorer.js';
import {
    initDb,
    jobExists,
    insertJob,
    getStats,
    deleteOldPosts,
    getLatestJobCreatedAt,
    startSidequestRun,
    updateSidequestRunStage,
    completeSidequestRunSuccess,
    completeSidequestRunFailure,
} from './db/turso.js';

const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

// Arctic Shift JSON API response types
interface RedditListing {
    data: RedditPost[];
}

interface RedditPost {
    id: string;
    title: string;
    selftext: string;
    author: string;
    subreddit: string;
    permalink: string;
    url: string;
    created_utc: number;
    is_self: boolean;
    over_18?: boolean;
}

function isPostFresh(createdUtc: number): boolean {
    const postDate = new Date(createdUtc * 1000);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

function isBoilerplateContent(content: string | null): boolean {
    if (!content) return true;
    const text = content.toLowerCase().trim();
    const boilerplatePatterns = ['submitted by', '[link]', '[comments]'];
    const hasBoilerplate = boilerplatePatterns.some((p) => text.includes(p));
    const isShort = text.length < 150;
    return hasBoilerplate && isShort;
}

function getSourceId(post: RedditPost): string {
    if (post.id) return post.id;
    const hash = createHash('sha256').update(post.permalink).digest('hex');
    return `reddit_${hash.substring(0, 12)}`;
}

// Fetch posts from the configured Reddit data source
// Returns null when the source failed (after retries) so the caller can detect outages.
async function fetchSubreddit(subreddit: string): Promise<RawPost[] | null> {
    const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&limit=100`;
    const attempts = 3;

    let response: Response | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            response = await fetch(url, {
                headers: {
                    'User-Agent': `SidequestBot-${CONFIG_NUM}/1.3 (https://sidequest.dev)`,
                    'Accept': 'application/json',
                },
                signal: AbortSignal.timeout(15000),
            });
            if (response.ok) break;
            // 422 = Arctic Shift "Timeout. Maybe slow down a bit" (load shedding; cost r/forhire every other run). Retry passes.
            const retryable = response.status === 422 || response.status === 429 || response.status >= 500;
            console.error(`[Bot-${CONFIG_NUM}] ❌ r/${subreddit}: HTTP ${response.status} (attempt ${attempt}/${attempts})`);
            if (!retryable) return null;
        } catch (error) {
            response = null;
            console.error(`[Bot-${CONFIG_NUM}] ❌ r/${subreddit}: network error – ${(error as Error).message} (attempt ${attempt}/${attempts})`);
        }
        if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
    if (!response?.ok) return null;

    let listing: RedditListing;
    try {
        listing = await response.json() as RedditListing;
    } catch (error) {
        console.error(`[Bot-${CONFIG_NUM}] ❌ r/${subreddit}: failed to parse JSON – ${(error as Error).message}`);
        return null;
    }

    const posts = listing?.data;
    if (!posts || posts.length === 0) {
        console.warn(`[Bot-${CONFIG_NUM}] ⚠️  r/${subreddit}: empty listing`);
        return [];
    }
    return toRawPosts(subreddit, posts);
}

function toRawPosts(subreddit: string, posts: RedditPost[]): RawPost[] {
    // Drop NSFW-flagged posts at fetch time
    const sfwPosts = posts.filter((post) => !post.over_18);
    if (sfwPosts.length < posts.length) {
        console.log(`   🚫 r/${subreddit}: dropped ${posts.length - sfwPosts.length} NSFW-flagged posts`);
    }

    return sfwPosts.map((post) => ({
        source: 'reddit' as const,
        sourceId: getSourceId(post),
        sourceUrl: `https://www.reddit.com${post.permalink}`,
        title: post.title || '',
        // Not just is_self: image/gallery posts carry the full job text too (10 of 18 HungryArtists gigs were lost to this).
        content: post.selftext && post.selftext !== '[removed]' && post.selftext !== '[deleted]'
            ? post.selftext
            : null,
        author: post.author || null,
        subreddit,
        postedAt: new Date(post.created_utc * 1000).toISOString(),
    }));
}

interface ScoredPost extends RawPost {
    scored: JobScore;
}

// Drop AI-scored posts below this (same default as the twitter/discord scrapers).
const MIN_SCORE = Number.parseInt(process.env.SIDEQUEST_MIN_SCORE || '4', 10) || 4;
// Fail the run (-> Discord alert) when this share of subreddits could not be fetched.
const MAX_SOURCE_FAILURE_RATIO = 0.8;

// Written by scripts/reddit_local_fetch.py on the laptop (logged-in browser, RSS, Arctic Shift).
interface LocalFetch {
    subreddits: Record<string, { channel?: string; posts?: RedditPost[]; error?: string }>;
}

function readLocalFetch(file: string, subreddits: string[], allPosts: RawPost[]): string[] {
    const local = JSON.parse(readFileSync(file, 'utf8')) as LocalFetch;
    console.log(`[Bot-${CONFIG_NUM}] 📡 Reading ${subreddits.length} subreddits from the local fetch (${file})`);
    const failed: string[] = [];
    for (const subreddit of subreddits) {
        const entry = local.subreddits[subreddit.toLowerCase()];
        const posts = entry?.posts ? toRawPosts(subreddit, entry.posts) : null;
        if (posts === null) failed.push(subreddit);
        console.log(`[Bot-${CONFIG_NUM}]    r/${subreddit}: ${posts === null ? `FAILED (${entry?.error ?? 'not fetched'})` : `${posts.length} posts via ${entry?.channel}`}`);
        allPosts.push(...(posts || []));
    }
    return failed;
}

async function fetchArcticShift(subreddits: string[], allPosts: RawPost[]): Promise<string[]> {
    console.log(`[Bot-${CONFIG_NUM}] 📡 Fetching from ${subreddits.length} subreddits via Arctic Shift...`);
    let pending = subreddits;
    // Second pass: a subreddit can keep answering 422 through all 3 attempts (~10 s); a bit later it usually works.
    for (let pass = 1; pass <= 2 && pending.length > 0; pass++) {
        if (pass === 2) {
            // Most subreddits failed = the mirror is down; a second pass would only run into the 30-min job limit.
            if (pending.length / subreddits.length >= 0.5) break;
            await new Promise((resolve) => setTimeout(resolve, 15000));
        }
        const failed: string[] = [];
        for (const [i, subreddit] of pending.entries()) {
            const posts = await fetchSubreddit(subreddit);
            if (posts === null) failed.push(subreddit);
            console.log(`[Bot-${CONFIG_NUM}]    r/${subreddit}${pass === 2 ? ' (second pass)' : ''}: ${posts === null ? 'FAILED' : `${posts.length} posts`}`);
            allPosts.push(...(posts || []));
            if (pass === 1 && i === 3 && failed.length === 4 && pending.length > 4) {
                console.warn(`[Bot-${CONFIG_NUM}] ⚠️  First 4 subreddits failed: Arctic Shift looks down, skipping the rest`);
                failed.push(...pending.slice(4));
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 600));
        }
        pending = failed;
    }
    return pending;
}

async function fetchRedditPosts(): Promise<{ fetched: number; posts: ScoredPost[] }> {
    const subreddits = getAllSubreddits();
    const localFile = process.env.REDDIT_PREFETCH_FILE;
    const allPosts: RawPost[] = [];
    const failedSubs = (localFile ? readLocalFetch(localFile, subreddits, allPosts) : await fetchArcticShift(subreddits, allPosts)).length;
    if (subreddits.length > 0 && failedSubs / subreddits.length >= MAX_SOURCE_FAILURE_RATIO) {
        const message = `Reddit source outage: ${failedSubs}/${subreddits.length} subreddits failed (${localFile ? 'local fetch' : 'Arctic Shift'})`;
        // On GitHub this bot only backs up the laptop's direct fetch, so a mirror outage is not worth a failure email.
        if (process.env.GITHUB_ACTIONS !== 'true') throw new Error(message);
        console.warn(`[Bot-${CONFIG_NUM}] ⚠️  ${message}; continuing with what was fetched`);
    }
    console.log(`[Bot-${CONFIG_NUM}] 📥 Fetched ${allPosts.length} total posts (${failedSubs} subreddits failed)`);

    const freshPosts = allPosts.filter((post) =>
        post.title?.trim() &&
        !isBoilerplateContent(post.content) &&
        post.postedAt &&
        isPostFresh(new Date(post.postedAt).getTime() / 1000)
    );
    // Same post is often cross-posted to several subs in one run.
    const unique = [...new Map(freshPosts.map((p) => [p.sourceId, p])).values()];
    const validPosts = unique.filter((post) => !shouldFilterPost(post.title, post.content || ''));
    console.log(`[Bot-${CONFIG_NUM}] 🚫 ${unique.length} fresh unique, ${validPosts.length} after negative filters`);

    // Cheap keyword pre-filter: drop only confident non-jobs before spending AI calls.
    const candidates = validPosts.filter((post) => {
        const k = keywordIntentCheck(post.title, post.content);
        return k.isJob || k.confidence < 0.85;
    });

    // Dedupe BEFORE AI: every run looks at the last 24 h, so most posts were already stored or (locally) rejected.
    const rejectedFile = process.env.REDDIT_REJECTED_FILE;
    const rejected = loadRejected(rejectedFile, MAX_POST_AGE_MS);
    const newPosts: RawPost[] = [];
    let skippedRejected = 0;
    for (const post of candidates) {
        if (rejected[post.sourceId]) skippedRejected++;
        else if (!(await jobExists(post.source, post.sourceId))) newPosts.push(post);
    }
    console.log(`[Bot-${CONFIG_NUM}] 💼 ${candidates.length} candidates, ${skippedRejected} rejected earlier, ${newPosts.length} not yet stored → scoring`);

    const scoredPosts: ScoredPost[] = [];
    for (const post of newPosts) {
        const scored = await scoreJob(post);
        const tag = `${scored.method} ${scored.score}/10 [${scored.professions.join(',')}]`;
        if (!scored.isJob || scored.professions.length === 0) {
            console.log(`[Bot-${CONFIG_NUM}]   ❌ ${tag} not a job: ${post.title.slice(0, 50)} (${scored.reason})`);
            if (scored.method === 'ai') rejected[post.sourceId] = Date.now(); // keyword fallback = AI failed, retry next run
        } else if (scored.method === 'ai' && scored.score < MIN_SCORE) {
            console.log(`[Bot-${CONFIG_NUM}]   ⬇️ ${tag} below min: ${post.title.slice(0, 50)} (${scored.reason})`);
            rejected[post.sourceId] = Date.now();
        } else {
            console.log(`[Bot-${CONFIG_NUM}]   ✅ ${tag} ${post.title.slice(0, 50)}`);
            scoredPosts.push({ ...post, scored });
        }
    }
    saveRejected(rejectedFile, rejected);
    return { fetched: allPosts.length, posts: scoredPosts };
}

async function processJobs(): Promise<{ fetched: number; newJobs: number }> {
    console.log(`[Bot-${CONFIG_NUM}] 🚀 Starting job processing...`);
    const { fetched, posts } = await fetchRedditPosts();

    let newJobsCount = 0;
    for (const post of posts) {
        const { scored } = post;
        const inserted = await insertJob(post, scored.professions, scored.score, scored.summary, scored.analysis, scored.matchScore);
        if (inserted) newJobsCount++;
        else console.log(`[Bot-${CONFIG_NUM}]   ↔️ already stored by the other runner: ${post.title.slice(0, 50)}`);
    }

    return { fetched, newJobs: newJobsCount };
}

// Main
async function main() {
    const startedAt = Date.now();
    const githubRunId = process.env.GITHUB_RUN_ID || null;
    const trigger = process.env.GITHUB_EVENT_NAME || 'local';
    
    console.log(`[Bot-${CONFIG_NUM}] 🎮 SideQuest Bot-${CONFIG_NUM} starting...`);
    console.log(`[Bot-${CONFIG_NUM}] ⏰ Time: ${new Date().toISOString()}`);
    console.log(`[Bot-${CONFIG_NUM}] 🔁 Trigger: ${trigger}`);

    try {
        validateConfig();
        await initDb();
        
        const latestBefore = await getLatestJobCreatedAt();
        const runRecordId = await startSidequestRun({
            githubRunId,
            trigger,
            stage: 'FETCH_STARTED',
            latestJobCreatedAtBefore: latestBefore,
        });

        const result = await processJobs();
        
        await completeSidequestRunSuccess(runRecordId, {
            fetchedCount: result.fetched,
            newJobsCount: result.newJobs,
            stage: 'RUN_COMPLETED',
            latestJobCreatedAtAfter: await getLatestJobCreatedAt(),
        });

        // Cleanup (only bot-01 runs cleanup to avoid conflicts)
        if (CONFIG_NUM === '01') {
            console.log(`[Bot-${CONFIG_NUM}] 🧹 Running cleanup...`);
            const deleted = await deleteOldPosts();
            console.log(`[Bot-${CONFIG_NUM}] 🗑️ Deleted ${deleted} old posts`);
        }

        const duration = Date.now() - startedAt;
        console.log(`[Bot-${CONFIG_NUM}] ✅ Completed in ${duration}ms`);
        console.log(`[Bot-${CONFIG_NUM}] 📊 Fetched: ${result.fetched}, New: ${result.newJobs}`);
        
        process.exit(0);
    } catch (error) {
        console.error(`[Bot-${CONFIG_NUM}] ❌ Error:`, error);
        process.exit(1);
    }
}

main();
