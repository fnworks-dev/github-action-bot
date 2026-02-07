import Parser from 'rss-parser';
import { config, shouldFilterPost, getAllSubreddits } from '../config.js';
import { categorizePost, generateSummary } from '../ai/categorizer.js';
import { filterByHiringIntent } from '../ai/intent-detector.js';
import { analyzeJob } from '../ai/analyzer.js';
import type { RawPost, Profession } from '../types.js';
import { createHash } from 'crypto';

const REDDIT_USER_AGENT = 'SidequestBot/1.2 (RSS Reader; https://sidequest.dev)';

// Max age for posts (24 hours)
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

// Create parser with custom headers to avoid 403
const parser = new Parser({
    headers: {
        'User-Agent': REDDIT_USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    timeout: 10000,
});

// Check if post is fresh (< 24h old)
function isPostFresh(postedAt: string | null): boolean {
    if (!postedAt) return true;
    const postDate = new Date(postedAt);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// Check if content is just Reddit RSS boilerplate
function isBoilerplateContent(content: string | null): boolean {
    if (!content) return true;
    const text = content.toLowerCase().trim();
    const boilerplatePatterns = ['submitted by', '[link]', '[comments]'];
    const hasBoilerplate = boilerplatePatterns.some((p) => text.includes(p));
    const isShort = text.length < 150;
    return hasBoilerplate && isShort;
}

// Fetch posts from a single subreddit via RSS only
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
        console.error(`Failed to fetch r/${subreddit}:`, error);
        return [];
    }
}

// Extract Reddit post ID from URL
function extractRedditId(url: string): string {
    const match = url.match(/\/comments\/([a-z0-9]+)/i);
    if (match) return match[1];

    // Safe fallback: use hash instead of raw URL
    const hash = createHash('sha256').update(url).digest('hex');
    return `reddit_${hash.substring(0, 12)}`;
}

// Enriched post with professions and AI analysis
export interface EnrichedPost extends RawPost {
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

/**
 * Fetch all subreddits, filter, and categorize by profession
 */
export async function fetchRedditPosts(): Promise<EnrichedPost[]> {
    const maxSubreddits = Math.max(
        1,
        Number.parseInt(process.env.SIDEQUEST_MAX_SUBREDDITS || '20', 10) || 20
    );
    const subreddits = getAllSubreddits().slice(0, maxSubreddits);
    console.log(`📡 Fetching from ${subreddits.length} subreddits via RSS...`);

    const allPosts: RawPost[] = [];

    for (const subreddit of subreddits) {
        const posts = await fetchSubreddit(subreddit);
        allPosts.push(...posts);

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`📥 Fetched ${allPosts.length} total posts from Reddit`);

    // Step 1: Filter out posts with empty content or title
    const postsWithContent = allPosts.filter(post =>
        post.title?.trim() && !isBoilerplateContent(post.content)
    );
    console.log(`✂️ Filtered out ${allPosts.length - postsWithContent.length} posts with empty/boilerplate content`);

    // Step 2: Filter by time (< 24h old)
    const freshPosts = postsWithContent.filter(post => isPostFresh(post.postedAt));
    console.log(`⏰ ${freshPosts.length} posts are fresh (< 24h old)`);

    // Step 3: Apply negative filters
    const validPosts = freshPosts.filter(post => !shouldFilterPost(post.title, post.content || ''));
    console.log(`🚫 ${freshPosts.length - validPosts.length} posts filtered by negative filters`);

    // Step 4: Detect hiring intent
    console.log(`💼 Detecting hiring intent for ${validPosts.length} posts...`);
    const jobPosts = await filterByHiringIntent(validPosts);
    console.log(`💼 ${jobPosts.length} posts show hiring intent`);

    // Step 5: Categorize and analyze with AI
    console.log(`🏷️ Categorizing and analyzing ${jobPosts.length} posts...`);
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
            console.error(`Failed to categorize post: ${post.title.slice(0, 50)}...`, error);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`✅ ${enrichedPosts.length} posts categorized with professions`);

    // Log profession distribution
    const professionCounts: Record<Profession, number> = {
        developer: 0,
        artist: 0,
        'voice-actor': 0,
        'video-editor': 0,
        writer: 0,
        audio: 0,
        qa: 0,
        'virtual-assistant': 0,
    };

    for (const post of enrichedPosts) {
        for (const prof of post.professions) {
            professionCounts[prof]++;
        }
    }

    console.log(`📊 Profession distribution:`);
    for (const [prof, count] of Object.entries(professionCounts)) {
        if (count > 0) {
            console.log(`   ${prof}: ${count}`);
        }
    }

    return enrichedPosts;
}

/**
 * Fetch posts from a specific profession's subreddits only
 */
export async function fetchPostsByProfession(professionKey: string): Promise<EnrichedPost[]> {
    const { professions: profs } = await import('../config.js');
    const profession = profs[professionKey as keyof typeof profs];

    if (!profession) {
        throw new Error(`Unknown profession: ${professionKey}`);
    }

    console.log(`📡 Fetching posts for ${profession.name} from ${profession.subreddits.length} subreddits...`);

    const allPosts: RawPost[] = [];

    for (const subreddit of profession.subreddits) {
        const posts = await fetchSubreddit(subreddit);
        allPosts.push(...posts);

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`📥 Fetched ${allPosts.length} total posts for ${profession.name}`);

    const postsWithContent = allPosts.filter(post =>
        post.title?.trim() && !isBoilerplateContent(post.content)
    );

    const freshPosts = postsWithContent.filter(post => isPostFresh(post.postedAt));

    const validPosts = freshPosts.filter(post => !shouldFilterPost(post.title, post.content || ''));

    console.log(`✂️ Filtered to ${validPosts.length} valid posts for ${profession.name}`);

    console.log(`💼 Detecting hiring intent for ${validPosts.length} posts...`);
    const jobPosts = await filterByHiringIntent(validPosts);
    console.log(`💼 ${jobPosts.length} posts show hiring intent for ${profession.name}`);

    console.log(`🏷️ Categorizing and analyzing ${jobPosts.length} posts...`);
    const enrichedPosts: EnrichedPost[] = [];

    for (const post of jobPosts) {
        try {
            const [categorization, summary, analysis] = await Promise.all([
                categorizePost(post.title, post.content),
                generateSummary(post.title, post.content),
                analyzeJob(post.title, post.content),
            ]);

            if (categorization.professions.includes(professionKey as Profession)) {
                enrichedPosts.push({
                    ...post,
                    professions: categorization.professions,
                    confidence: categorization.confidence,
                    summary,
                    analysis,
                });
            }
        } catch (error) {
            console.error(`Failed to categorize post: ${post.title.slice(0, 50)}...`, error);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`✅ ${enrichedPosts.length} posts matched ${profession.name}`);

    return enrichedPosts;
}
