import { config, shouldFilterPost, getAllSubreddits } from '../config.js';
import { categorizePost, generateSummary } from '../ai/categorizer.js';
import { filterByHiringIntent } from '../ai/intent-detector.js';
import { analyzeJob } from '../ai/analyzer.js';
import type { RawPost, Profession } from '../types.js';
import { createHash } from 'crypto';

// Max age for posts (24 hours)
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

// Arctic Shift JSON API response types (Reddit mirror)
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

// Check if post is fresh (< 24h old)
function isPostFresh(createdUtc: number): boolean {
    const postDate = new Date(createdUtc * 1000);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// Extract a consistent source ID from Reddit post
function getSourceId(post: RedditPost): string {
    if (post.id) return post.id;
    const hash = createHash('sha256').update(post.permalink).digest('hex');
    return `reddit_${hash.substring(0, 12)}`;
}

// Fetch posts from a single subreddit using Arctic Shift mirror
// This bypasses GitHub Actions IP blocks that affect direct Reddit API
async function fetchSubreddit(subreddit: string, retries = 2): Promise<RawPost[]> {
    // Arctic Shift mirror - escapes GitHub Actions IP blocks
    const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&limit=25`;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'SidequestBot/1.3 (https://sidequest.dev)',
                    'Accept': 'application/json',
                },
                signal: AbortSignal.timeout(12000),
            });

            if (!response.ok) {
                // Retry on 5xx errors or rate limit (429)
                if ((response.status >= 500 || response.status === 429) && attempt < retries) {
                    const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
                    console.warn(`⚠️  r/${subreddit}: HTTP ${response.status}, retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                console.error(`❌ r/${subreddit}: HTTP ${response.status} ${response.statusText}`);
                return [];
            }

            const listing = await response.json() as RedditListing;
            const posts = listing?.data;
            
            if (!posts || posts.length === 0) {
                console.warn(`⚠️  r/${subreddit}: empty listing`);
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
        } catch (error) {
            const isTimeout = (error as Error).name === 'AbortError';
            const isNetwork = !isTimeout;
            
            if (isNetwork && attempt < retries) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⚠️  r/${subreddit}: network error, retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            
            console.error(`❌ r/${subreddit}: ${isTimeout ? 'timeout' : 'network error'} – ${(error as Error).message}`);
            return [];
        }
    }
    
    return []; // Should not reach here
}

// Check if content is just Reddit boilerplate (less common with Arctic Shift but keep for safety)
function isBoilerplateContent(content: string | null): boolean {
    if (!content) return true;
    const text = content.toLowerCase().trim();
    const boilerplatePatterns = ['submitted by', '[link]', '[comments]'];
    const hasBoilerplate = boilerplatePatterns.some((p) => text.includes(p));
    const isShort = text.length < 150;
    return hasBoilerplate && isShort;
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
    console.log(`📡 Fetching from ${subreddits.length} subreddits via Arctic Shift API...`);

    const allPosts: RawPost[] = [];

    for (const subreddit of subreddits) {
        const posts = await fetchSubreddit(subreddit);
        console.log(`   r/${subreddit}: ${posts.length} posts`);
        allPosts.push(...posts);

        // Small delay to avoid rate limiting (400ms = 8s for 20 subs, well within limits)
        await new Promise((resolve) => setTimeout(resolve, 400));
    }

    console.log(`📥 Fetched ${allPosts.length} total posts from Reddit`);

    // Step 1: Filter out posts with empty content or title
    const postsWithContent = allPosts.filter(post =>
        post.title?.trim() && !isBoilerplateContent(post.content)
    );
    console.log(`✂️ Filtered out ${allPosts.length - postsWithContent.length} posts with empty/boilerplate content`);

    // Step 2: Filter by time (< 24h old) - already filtered by Arctic Shift but double-check
    const freshPosts = postsWithContent.filter(post => {
        if (!post.postedAt) return false;
        const postTime = new Date(post.postedAt).getTime() / 1000;
        return isPostFresh(postTime);
    });
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

        // AI rate limiting (500ms = faster processing, still respectful)
        await new Promise((resolve) => setTimeout(resolve, 500));
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
        console.log(`   r/${subreddit}: ${posts.length} posts`);
        allPosts.push(...posts);

        await new Promise((resolve) => setTimeout(resolve, 600));
    }

    console.log(`📥 Fetched ${allPosts.length} total posts for ${profession.name}`);

    const postsWithContent = allPosts.filter(post =>
        post.title?.trim() && !isBoilerplateContent(post.content)
    );

    const freshPosts = postsWithContent.filter(post => {
        if (!post.postedAt) return false;
        const postTime = new Date(post.postedAt).getTime() / 1000;
        return isPostFresh(postTime);
    });

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

        // AI rate limiting (500ms = faster processing, still respectful)
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`✅ ${enrichedPosts.length} posts matched ${profession.name}`);

    return enrichedPosts;
}
