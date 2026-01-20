import type { RawPost } from '../types.js';
import { config } from '../config.js';

// Max age for posts (24 hours)
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

interface HNSearchResult {
    hits: Array<{
        objectID: string;
        title: string;
        story_text?: string;
        author: string;
        url?: string;
        created_at: string;
        story_url?: string;
    }>;
}

// Check if post is fresh (< 24h old)
function isPostFresh(postedAt: string | null): boolean {
    if (!postedAt) return true;
    const postDate = new Date(postedAt);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// Fetch posts from Hacker News Algolia API
export async function fetchHNPosts(): Promise<RawPost[]> {
    console.log('📡 Fetching from Hacker News...');

    const allPosts: RawPost[] = [];

    // Search queries optimized for HN - these already filter for hiring intent
    // Note: HN Algolia searches title + story_text, so these queries are effective
    const searchQueries = [
        // Direct hiring queries
        'looking for developer',
        'need developer',
        'hiring developer',
        'seeking developer',

        // Cofounder queries (common on HN)
        'technical cofounder',
        'cofounder wanted',
        'looking for cofounder',
        'seeking cofounder',

        // Ask HN format (high quality leads)
        'Ask HN: hiring',
        'Ask HN: looking for',
        'Ask HN: need developer',

        // "Who is hiring" threads (monthly goldmine)
        'Who is hiring',
        'Who wants to be hired',

        // Freelance/build requests
        'freelancer needed',
        'help build',
        'need someone to build',
    ];

    for (const query of searchQueries) {
        try {
            // Fetch more results per query, filter by date in API
            const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=30&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - 86400}`;
            const response = await fetch(url);
            const data: HNSearchResult = await response.json();

            const posts = data.hits.map((hit) => ({
                source: 'hackernews' as const,
                sourceId: hit.objectID,
                sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
                title: hit.title || '',
                content: hit.story_text || null,
                author: hit.author || null,
                postedAt: hit.created_at || null,
            }));

            allPosts.push(...posts);

            // Small delay to be respectful to API
            await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
            console.error(`Failed to search HN for "${query}":`, error);
        }
    }

    // Deduplicate by sourceId
    const uniquePosts = allPosts.filter(
        (post, index, self) =>
            index === self.findIndex((p) => p.sourceId === post.sourceId)
    );

    console.log(`📥 Fetched ${uniquePosts.length} unique posts from HN`);

    // Only require title (most HN posts are link posts without body text)
    const postsWithTitle = uniquePosts.filter(post => post.title?.trim());
    console.log(`✂️ Kept ${postsWithTitle.length} posts with valid titles`);

    // Filter: negative filters only (search queries already filter for intent)
    // Skip posts that match negative patterns
    const filteredPosts = postsWithTitle.filter((post) => {
        const text = `${post.title} ${post.content || ''}`.toLowerCase();

        // Check negative filters - skip self-promotion, spam, etc.
        const hasNegative = config.negativeFilters.some((filter) =>
            text.includes(filter.toLowerCase())
        );

        return !hasNegative;
    });

    console.log(`🎯 ${filteredPosts.length} HN posts after negative filter (< 24h old)`);

    return filteredPosts;
}
