import { config } from '../config.js';
import type { RawPost } from '../types.js';
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

// Fetch posts from a single subreddit using the JSON API
async function fetchSubreddit(subreddit: string): Promise<RawPost[]> {
    // Escaping GitHub Actions IP blocks using Arctic Shift mirror
    const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&limit=25`;

    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                'User-Agent': 'FNworks-LeadBot/1.0 (https://fnworks.dev)',
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(12000),
        });
    } catch (error) {
        console.error(`❌ r/${subreddit}: network error – ${(error as Error).message}`);
        return [];
    }

    if (!response.ok) {
        console.error(`❌ r/${subreddit}: HTTP ${response.status} ${response.statusText}`);
        return [];
    }

    let listing: RedditListing;
    try {
        listing = await response.json() as RedditListing;
    } catch (error) {
        console.error(`❌ r/${subreddit}: failed to parse JSON – ${(error as Error).message}`);
        return [];
    }

    const posts = listing?.data;
    if (!posts || posts.length === 0) {
        console.warn(`⚠️  r/${subreddit}: empty listing (possible IP block or empty sub)`);
        return [];
    }

    return posts.map((post) => ({
        source: 'reddit' as const,
        sourceId: getSourceId(post),
        sourceUrl: `https://www.reddit.com${post.permalink}`,
        title: post.title || '',
        // Use selftext for text posts; link posts have no body
        content: post.is_self && post.selftext && post.selftext !== '[removed]'
            ? post.selftext
            : null,
        author: post.author || null,
        subreddit,
        postedAt: new Date(post.created_utc * 1000).toISOString(),
    }));
}

// Check if post matches keywords, passes negative filters, and is fresh
function matchesKeywords(post: RawPost): boolean {
    const text = `${post.title} ${post.content || ''}`.toLowerCase();

    // Check if post is fresh (< 24h old)
    if (!isPostFresh(new Date(post.postedAt!).getTime() / 1000)) {
        return false;
    }

    // Check negative filters first - skip if matches
    const hasNegative = config.negativeFilters.some((filter) =>
        text.includes(filter.toLowerCase())
    );
    if (hasNegative) {
        return false;
    }

    // Check positive keywords
    return config.keywords.some((keyword) =>
        text.includes(keyword.toLowerCase())
    );
}

// Fetch all subreddits and filter by keywords
export async function fetchRedditPosts(): Promise<RawPost[]> {
    console.log(`📡 Fetching from ${config.subreddits.length} subreddits via JSON API...`);

    const allPosts: RawPost[] = [];

    for (const subreddit of config.subreddits) {
        const posts = await fetchSubreddit(subreddit);
        console.log(`   r/${subreddit}: ${posts.length} posts`);
        allPosts.push(...posts);

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 600));
    }

    console.log(`📥 Fetched ${allPosts.length} total posts from Reddit`);

    // Filter by keywords, negative filters, and freshness
    const matchingPosts = allPosts.filter(matchesKeywords);
    console.log(`🎯 ${matchingPosts.length} posts match keywords (< 24h old)`);

    return matchingPosts;
}
