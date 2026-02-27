#!/usr/bin/env node
/**
 * SideQuest Bot - Split Config Version
 * Usage: CONFIG=01 npm start
 * 
 * Uses Arctic Shift API to bypass GitHub Actions IP blocks
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
import { categorizePost, generateSummary } from './ai/categorizer.js';
import { filterByHiringIntent } from './ai/intent-detector.js';
import { analyzeJob } from './ai/analyzer.js';
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

// Fetch posts from Arctic Shift mirror (bypasses GitHub Actions IP blocks)
async function fetchSubreddit(subreddit: string): Promise<RawPost[]> {
    const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&limit=25`;

    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                'User-Agent': `SidequestBot-${CONFIG_NUM}/1.3 (https://sidequest.dev)`,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(12000),
        });
    } catch (error) {
        console.error(`[Bot-${CONFIG_NUM}] ❌ r/${subreddit}: network error – ${(error as Error).message}`);
        return [];
    }

    if (!response.ok) {
        console.error(`[Bot-${CONFIG_NUM}] ❌ r/${subreddit}: HTTP ${response.status} ${response.statusText}`);
        return [];
    }

    let listing: RedditListing;
    try {
        listing = await response.json() as RedditListing;
    } catch (error) {
        console.error(`[Bot-${CONFIG_NUM}] ❌ r/${subreddit}: failed to parse JSON – ${(error as Error).message}`);
        return [];
    }

    const posts = listing?.data;
    if (!posts || posts.length === 0) {
        console.warn(`[Bot-${CONFIG_NUM}] ⚠️  r/${subreddit}: empty listing`);
        return [];
    }

    return posts.map((post) => ({
        source: 'reddit' as const,
        sourceId: getSourceId(post),
        sourceUrl: `https://www.reddit.com${post.permalink}`,
        title: post.title || '',
        content: post.is_self && post.selftext && post.selftext !== '[removed]'
            ? post.selftext
            : null,
        author: post.author || null,
        subreddit,
        postedAt: new Date(post.created_utc * 1000).toISOString(),
    }));
}

interface EnrichedPost extends RawPost {
    professions: Profession[];
    confidence: number;
    summary: string;
    analysis?: {
        project_type: string | null;
        tech_stack: string[] | null;
        scope: string | null;
        timeline_signal: string | null;
        budget_signal: string | null;
        red_flags: string[];
        green_flags: string[];
    };
}

async function fetchRedditPosts(): Promise<EnrichedPost[]> {
    const subreddits = getAllSubreddits();
    console.log(`[Bot-${CONFIG_NUM}] 📡 Fetching from ${subreddits.length} subreddits via Arctic Shift...`);

    const allPosts: RawPost[] = [];
    for (const subreddit of subreddits) {
        const posts = await fetchSubreddit(subreddit);
        console.log(`[Bot-${CONFIG_NUM}]    r/${subreddit}: ${posts.length} posts`);
        allPosts.push(...posts);
        await new Promise((resolve) => setTimeout(resolve, 600)); // 600ms delay between requests
    }

    console.log(`[Bot-${CONFIG_NUM}] 📥 Fetched ${allPosts.length} total posts`);

    const postsWithContent = allPosts.filter(post =>
        post.title?.trim() && !isBoilerplateContent(post.content)
    );
    console.log(`[Bot-${CONFIG_NUM}] ✂️ Filtered: ${allPosts.length - postsWithContent.length} empty/boilerplate`);

    const freshPosts = postsWithContent.filter(post => {
        if (!post.postedAt) return false;
        const postTime = new Date(post.postedAt).getTime() / 1000;
        return isPostFresh(postTime);
    });
    console.log(`[Bot-${CONFIG_NUM}] ⏰ Fresh posts: ${freshPosts.length}`);

    const validPosts = freshPosts.filter(post => !shouldFilterPost(post.title, post.content || ''));
    console.log(`[Bot-${CONFIG_NUM}] 🚫 After negative filters: ${validPosts.length}`);

    console.log(`[Bot-${CONFIG_NUM}] 💼 Detecting hiring intent...`);
    const jobPosts = await filterByHiringIntent(validPosts);
    console.log(`[Bot-${CONFIG_NUM}] 💼 ${jobPosts.length} show hiring intent`);

    console.log(`[Bot-${CONFIG_NUM}] 🏷️ Categorizing ${jobPosts.length} posts...`);
    const enrichedPosts: EnrichedPost[] = [];

    for (const post of jobPosts) {
        try {
            const [categorization, summary, analysis] = await Promise.all([
                categorizePost(post.title, post.content),
                generateSummary(post.title, post.content),
                analyzeJob(post.title, post.content),
            ]);

            if (categorization.professions.length > 0) {
                enrichedPosts.push({
                    ...post,
                    professions: categorization.professions,
                    confidence: categorization.confidence,
                    summary,
                    analysis,
                });
            }
        } catch (error) {
            console.error(`[Bot-${CONFIG_NUM}] Failed to categorize: ${post.title.slice(0, 50)}...`, error);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`[Bot-${CONFIG_NUM}] ✅ ${enrichedPosts.length} posts categorized`);
    return enrichedPosts;
}

async function processJobs(): Promise<{ fetched: number; newJobs: number }> {
    console.log(`[Bot-${CONFIG_NUM}] 🚀 Starting job processing...`);
    const posts = await fetchRedditPosts();
    let newJobsCount = 0;

    for (const post of posts) {
        const exists = await jobExists(post.source, post.sourceId);
        if (exists) continue;

        console.log(`[Bot-${CONFIG_NUM}] 📝 New job: ${post.title.slice(0, 60)}...`);
        await insertJob(post, post.professions, null, post.summary, post.analysis);
        newJobsCount++;
    }

    return { fetched: posts.length, newJobs: newJobsCount };
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
