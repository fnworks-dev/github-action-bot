import Parser from 'rss-parser';
import { config, shouldFilterPost } from '../config.js';
import type { RawPost } from '../types.js';

// Max age for posts (24 hours)
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

// Create parser with custom headers to avoid 403
const parser = new Parser({
    headers: {
        'User-Agent': 'ProblemResearch/1.0 (https://fnworks.dev)',
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

// Fetch posts from a single subreddit
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
    return match ? match[1] : url;
}

// Basic filtering: time and spam only (AI does relevance)
function passesBasicFilters(post: RawPost): boolean {
    // Check if post is fresh (< 24h old)
    if (!isPostFresh(post.postedAt)) {
        return false;
    }

    // Check spam filters
    if (shouldFilterPost(post.title, post.content || '')) {
        return false;
    }

    return true;
}

// Fetch all subreddits - NO keyword filtering, AI will decide
export async function fetchRedditPosts(): Promise<RawPost[]> {
    console.log(`📡 Fetching from ${config.subreddits.length} subreddits...`);

    const allPosts: RawPost[] = [];

    for (const subreddit of config.subreddits) {
        const posts = await fetchSubreddit(subreddit);
        allPosts.push(...posts);

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log(`📥 Fetched ${allPosts.length} total posts from Reddit`);

    // Only basic filtering (time + spam), AI will filter for relevance
    const filteredPosts = allPosts.filter(passesBasicFilters);
    console.log(`🎯 ${filteredPosts.length} posts pass basic filters (< 24h, no spam)`);

    return filteredPosts;
}
