#!/usr/bin/env node
/**
 * SideQuest Bot - Split Config Version
 * Usage: CONFIG=01 npm start
 */

import { createClient } from '@libsql/client';
import type { RawPost, Profession, SidequestRunStage } from './types.js';

const CONFIG_NUM = process.env.CONFIG || '01';

// Dynamically import the correct config
const configModule = await import(`./configs/config-${CONFIG_NUM}.js`);
const { config, validateConfig, getAllSubreddits, shouldFilterPost } = configModule;
const professions = configModule.professions;

// Import other modules
import Parser from 'rss-parser';
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

const REDDIT_USER_AGENT = `script:fnworks.sidequest-bot-${CONFIG_NUM}:v1.2 (by /u/fnworks-dev)`;
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

const parser = new Parser({
    headers: {
        'User-Agent': REDDIT_USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    timeout: 10000,
});

function isPostFresh(postedAt: string | null): boolean {
    if (!postedAt) return true;
    const postDate = new Date(postedAt);
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

function extractRedditId(url: string): string {
    const match = url.match(/\/comments\/([a-z0-9]+)/i);
    if (match) return match[1];
    const hash = createHash('sha256').update(url).digest('hex');
    return `reddit_${hash.substring(0, 12)}`;
}

async function fetchSubreddit(subreddit: string): Promise<RawPost[]> {
    try {
        const url = `https://www.reddit.com/r/${subreddit}/new/.rss`;
        const feed = await parser.parseURL(url);
        return feed.items.map((item) => ({
            source: 'reddit' as const,
            sourceId: extractRedditId(item.link || ''),
            sourceUrl: item.link || '',
            title: item.title || '',
            content: item.contentSnippet || item.content || null,
            author: item.creator || item.author || null,
            subreddit,
            postedAt: item.pubDate || null,
        }));
    } catch (error) {
        console.error(`Failed to fetch r/${subreddit}:`, (error as Error).message);
        return [];
    }
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
    console.log(`[Bot-${CONFIG_NUM}] 📡 Fetching from ${subreddits.length} subreddits via RSS...`);

    const allPosts: RawPost[] = [];
    for (const subreddit of subreddits) {
        const posts = await fetchSubreddit(subreddit);
        allPosts.push(...posts);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1s delay between requests
    }

    console.log(`[Bot-${CONFIG_NUM}] 📥 Fetched ${allPosts.length} total posts`);

    const postsWithContent = allPosts.filter(post =>
        post.title?.trim() && !isBoilerplateContent(post.content)
    );
    console.log(`[Bot-${CONFIG_NUM}] ✂️ Filtered: ${allPosts.length - postsWithContent.length} empty/boilerplate`);

    const freshPosts = postsWithContent.filter(post => isPostFresh(post.postedAt));
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
            console.error(`Failed to categorize: ${post.title.slice(0, 50)}...`, error);
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
            stage: 'RUNNING',
            latestJobCreatedAtBefore: latestBefore,
        });

        const result = await processJobs();
        
        await completeSidequestRunSuccess(runRecordId, {
            fetchedCount: result.fetched,
            newJobsCount: result.newJobs,
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
