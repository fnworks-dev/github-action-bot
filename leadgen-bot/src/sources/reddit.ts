import Parser from 'rss-parser';
import { config } from '../config.js';
import type { RawPost } from '../types.js';
import { createHash } from 'crypto';

// Max age for posts (24 hours)
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

// Create parser with custom headers to avoid 403
const parser = new Parser({
    headers: {
        'User-Agent': 'FNworks-LeadBot/1.0 (https://fnworks.dev)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    timeout: 10000,
});

// Check if post is fresh (< 24h old)
function isPostFresh(postedAt: string | null): boolean {
    if (!postedAt) return true; // If no date, include it
    const postDate = new Date(postedAt);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// Check if content is just Reddit RSS boilerplate (not real post content)
function isBoilerplateContent(content: string | null): boolean {
    if (!content) return true;
    const text = content.toLowerCase().trim();
    // Reddit RSS boilerplate patterns
    const boilerplatePatterns = ['submitted by', '[link]', '[comments]'];
    const hasBoilerplate = boilerplatePatterns.some((p) => text.includes(p));
    const isShort = text.length < 150; // Boilerplate is usually short
    return hasBoilerplate && isShort;
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
    if (match) return match[1];

    // Safe fallback: use hash instead of raw URL to avoid special characters
    // that could cause SQL parameter issues with Turso
    const hash = createHash('sha256').update(url).digest('hex');
    return `reddit_${hash.substring(0, 12)}`; // First 12 chars is sufficient uniqueness
}

// Check if post matches keywords, passes negative filters, and is fresh
function matchesKeywords(post: RawPost): boolean {
    const text = `${post.title} ${post.content || ''}`.toLowerCase();

    // Check if post is fresh (< 24h old)
    if (!isPostFresh(post.postedAt)) {
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
    console.log(`📡 Fetching from ${config.subreddits.length} subreddits...`);

    const allPosts: RawPost[] = [];

    for (const subreddit of config.subreddits) {
        const posts = await fetchSubreddit(subreddit);
        allPosts.push(...posts);

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`📥 Fetched ${allPosts.length} total posts from Reddit`);

    // Filter out posts with empty content or title
    const postsWithContent = allPosts.filter(post =>
        post.title?.trim() && !isBoilerplateContent(post.content)
    );
    console.log(`✂️ Filtered out ${allPosts.length - postsWithContent.length} posts with empty/boilerplate content`);

    // Filter by keywords, negative filters, and time
    const matchingPosts = postsWithContent.filter(matchesKeywords);
    console.log(`🎯 ${matchingPosts.length} posts match keywords (< 24h old)`);

    return matchingPosts;
}
