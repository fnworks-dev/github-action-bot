import { shouldFilterPost } from '../config.js';
import type { RawPost } from '../types.js';

// Max age for posts (24 hours)
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

// HN API endpoints
const HN_TOP_STORIES = 'https://hacker-news.firebaseio.com/v0/newstories.json';
const HN_ITEM = 'https://hacker-news.firebaseio.com/v0/item';

// Check if post is fresh (< 24h old)
function isPostFresh(timestamp: number): boolean {
    const postDate = new Date(timestamp * 1000);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// Fetch a single HN item
async function fetchItem(id: number): Promise<any | null> {
    try {
        const response = await fetch(`${HN_ITEM}/${id}.json`);
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

// Fetch HN posts (Ask HN, Show HN with problems)
export async function fetchHNPosts(): Promise<RawPost[]> {
    console.log('📡 Fetching from HackerNews...');

    try {
        const response = await fetch(HN_TOP_STORIES);
        if (!response.ok) {
            console.error('Failed to fetch HN stories');
            return [];
        }

        const storyIds: number[] = await response.json();
        // Get latest 100 stories
        const recentIds = storyIds.slice(0, 100);

        const posts: RawPost[] = [];

        for (const id of recentIds) {
            const item = await fetchItem(id);
            if (!item || item.type !== 'story' || item.dead || item.deleted) continue;

            // Check freshness
            if (!isPostFresh(item.time)) continue;

            // Check spam filters
            if (shouldFilterPost(item.title || '', item.text || '')) continue;

            // Prioritize "Ask HN" posts - these are often problem discussions
            const title = item.title || '';
            const isAskHN = title.startsWith('Ask HN:');

            posts.push({
                source: 'hackernews',
                sourceId: String(id),
                sourceUrl: item.url || `https://news.ycombinator.com/item?id=${id}`,
                title: title,
                content: item.text || null,
                author: item.by || null,
                subreddit: isAskHN ? 'Ask HN' : 'HN',
                postedAt: new Date(item.time * 1000).toISOString(),
            });

            // Rate limiting
            if (posts.length >= 50) break;
            await new Promise(r => setTimeout(r, 50));
        }

        console.log(`📥 Fetched ${posts.length} posts from HackerNews`);
        return posts;
    } catch (error) {
        console.error('HN fetch error:', error);
        return [];
    }
}
