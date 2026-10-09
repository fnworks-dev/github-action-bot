import { config, shouldFilterPost } from '../config.js';
import type { RawPost } from '../types.js';

// Max age for posts (24 hours)
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;
// ~1,000 fresh posts/day across the subreddits; the newest 8 per subreddit keep AI analysis ~35 min and GLM calls sane.
const MAX_POSTS_PER_SUBREDDIT = Number(process.env.MAX_POSTS_PER_SUBREDDIT) || 8;

interface ArcticShiftPost {
    id: string;
    permalink: string;
    title?: string;
    selftext?: string;
    is_self?: boolean;
    author?: string;
    created_utc: number;
    over_18?: boolean;
}

// Check if post is fresh (< 24h old)
function isPostFresh(postedAt: string | null): boolean {
    if (!postedAt) return true;
    const postDate = new Date(postedAt);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// reddit.com answers GitHub runner IPs with 429 (all but one subreddit since at least 2026-08-14), so read the
// Arctic Shift mirror like sidequest-bot. Its 422 "Timeout. Maybe slow down a bit" is load shedding: retry.
// Returns null when the subreddit could not be fetched.
async function fetchSubreddit(subreddit: string): Promise<RawPost[] | null> {
    const after = Math.floor((Date.now() - MAX_POST_AGE_MS) / 1000);
    const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&after=${after}&sort=desc&limit=100`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'ProblemResearch/1.1 (https://fnworks.dev)', 'Accept': 'application/json' },
                signal: AbortSignal.timeout(20000),
            });
            if (res.ok) {
                const posts = ((await res.json()) as { data?: ArcticShiftPost[] | null }).data ?? [];
                return posts.filter((p) => !p.over_18).map((p) => ({
                    source: 'reddit' as const,
                    sourceId: p.id,
                    sourceUrl: `https://www.reddit.com${p.permalink}`,
                    title: p.title || '',
                    content: p.is_self && p.selftext && !['[removed]', '[deleted]'].includes(p.selftext) ? p.selftext : null,
                    author: p.author || null,
                    subreddit,
                    postedAt: new Date(p.created_utc * 1000).toISOString(),
                }));
            }
            console.error(`   r/${subreddit}: HTTP ${res.status} (attempt ${attempt}/3)`);
            if (res.status !== 422 && res.status !== 429 && res.status < 500) return null;
        } catch (error) {
            console.error(`   r/${subreddit}: ${(error as Error).message} (attempt ${attempt}/3)`);
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
    return null;
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

    const kept: RawPost[] = [];
    const failed: string[] = [];
    let fetched = 0;

    for (const subreddit of config.subreddits) {
        const posts = await fetchSubreddit(subreddit);
        if (posts === null) failed.push(subreddit);
        fetched += posts?.length ?? 0;
        // Only basic filtering (time + spam), AI will filter for relevance. Capped per subreddit: posts with a
        // body first (61% were title-only links/images), newest first within each group (stable sort).
        const fresh = (posts ?? []).filter(passesBasicFilters).sort((a, b) => Number(!!b.content) - Number(!!a.content));
        kept.push(...fresh.slice(0, MAX_POSTS_PER_SUBREDDIT));

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 600));
    }

    console.log(`📥 Fetched ${fetched} total posts from Reddit (${failed.length} subreddits failed${failed.length ? `: ${failed.join(', ')}` : ''})`);
    console.log(`🎯 ${kept.length} posts pass basic filters (< 24h, no spam, max ${MAX_POSTS_PER_SUBREDDIT}/subreddit)`);

    return kept;
}
