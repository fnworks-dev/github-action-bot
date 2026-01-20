/**
 * TwitterAPI.io Integration
 *
 * Uses TwitterAPI.io REST API for searching tweets without official Twitter API.
 * Pricing: $0.15 per 1,000 tweets
 *
 * Docs: https://twitterapi.io
 * Endpoint: GET /twitter/tweet/advanced_search
 */

import type { RawPost } from '../types.js';
import { config } from '../config.js';

// Configuration from environment
const TWITTERAPI_KEY = process.env.TWITTERAPI_KEY || '';
const TWITTERAPI_BASE_URL = 'https://api.twitterapi.io';

// Rate limit: Free users can only make 1 request per 5 seconds
const REQUEST_DELAY_MS = 5500; // 5.5 seconds to be safe

// Optimized 8 high-value queries (~$4.32/month at 6 runs/day)
// Each query costs ~300 credits (20 tweets × 15 credits)
const SEARCH_QUERIES = [
    // Core hiring intent
    '"looking for a developer"',
    '"need a developer"',
    '"hiring a developer"',

    // Cofounder/Startup
    '"looking for technical cofounder"',
    '"developer for my startup"',

    // Project-based
    '"need someone to build"',

    // Freelance/Agency
    '"looking for freelancer"',
    '"looking for an agency"',
];

// Enhanced negative filters - remove job seekers, spam, and irrelevant content
const TWITTER_NEGATIVE_FILTERS = [
    // Job seekers (opposite of what we want)
    "i'm a developer",
    "i am a developer",
    "developer looking for",
    "open to work",
    "available for hire",
    "seeking work",
    "for hire",
    "looking for work",
    "looking for job",
    "looking for opportunities",

    // Self-promotion
    "my portfolio",
    "check out my",
    "i built",
    "hire me",
    "dm for rates",

    // Crypto/Web3 spam
    "crypto developer",
    "web3",
    "blockchain developer",
    "stole my",
    "scam",
    "rug pull",

    // Generic/Educational content
    "don't need to be",
    "you don't need",
    "how to become",
    "learn to be",
    "tutorial",
    "course",

    // Include shared config filters too
    ...config.negativeFilters,
];

interface TwitterApiTweet {
    id: string;
    text: string;
    author?: {
        id: string;
        userName: string;
        name: string;
    };
    createdAt?: string;
    retweetCount?: number;
    likeCount?: number;
    replyCount?: number;
    url?: string;
}

interface TwitterApiResponse {
    tweets: TwitterApiTweet[];
    has_next_page?: boolean;
    next_cursor?: string;
}

/**
 * Search tweets using TwitterAPI.io advanced search
 */
async function searchTweets(query: string): Promise<TwitterApiTweet[]> {
    try {
        const url = new URL(`${TWITTERAPI_BASE_URL}/twitter/tweet/advanced_search`);
        url.searchParams.set('query', query);
        url.searchParams.set('queryType', 'Latest');

        console.log(`  🔍 Searching: "${query}"`);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'X-API-Key': TWITTERAPI_KEY,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  ❌ TwitterAPI.io error ${response.status}: ${errorText}`);
            return [];
        }

        const data: TwitterApiResponse = await response.json();
        console.log(`  ✅ Found ${data.tweets?.length || 0} tweets`);

        return data.tweets || [];
    } catch (error) {
        console.error(`  ❌ Search failed for "${query}":`, error);
        return [];
    }
}

/**
 * Check if tweet content matches any negative filter
 */
function matchesNegativeFilter(text: string): boolean {
    const textLower = text.toLowerCase();
    return TWITTER_NEGATIVE_FILTERS.some(filter => textLower.includes(filter.toLowerCase()));
}

/**
 * Check if tweet is within the last 24 hours
 */
function isRecent(createdAt: string | undefined): boolean {
    if (!createdAt) return true; // Include if no date
    try {
        const tweetDate = new Date(createdAt);
        const now = new Date();
        const diffMs = now.getTime() - tweetDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        return diffHours <= 24;
    } catch {
        return true; // Include if date parsing fails
    }
}

/**
 * Transform TwitterAPI.io tweet to RawPost format
 */
function transformToRawPost(tweet: TwitterApiTweet): RawPost {
    const tweetUrl = tweet.url || `https://x.com/i/web/status/${tweet.id}`;

    return {
        source: 'x' as const,
        sourceId: tweet.id,
        sourceUrl: tweetUrl,
        title: tweet.text.slice(0, 100) + (tweet.text.length > 100 ? '...' : ''),
        content: tweet.text,
        author: tweet.author?.userName || tweet.author?.name || null,
        subreddit: null,
        postedAt: tweet.createdAt || null,
    };
}

/**
 * Fetch tweets from Twitter/X using TwitterAPI.io
 *
 * @returns Array of raw posts matching hiring intent
 */
export async function fetchTwitterApiPosts(): Promise<RawPost[]> {
    if (!TWITTERAPI_KEY) {
        console.log('⏭️ TwitterAPI.io is disabled (no TWITTERAPI_KEY), skipping...');
        return [];
    }

    console.log('📡 Fetching from Twitter/X via TwitterAPI.io...');
    console.log(`  📋 ${SEARCH_QUERIES.length} search queries`);
    console.log(`  ⏱️ Rate limit: 1 request per 5 seconds (free tier)`);

    const allTweets: TwitterApiTweet[] = [];

    for (let i = 0; i < SEARCH_QUERIES.length; i++) {
        const query = SEARCH_QUERIES[i];

        const tweets = await searchTweets(query);
        allTweets.push(...tweets);

        // Rate limit delay between requests (except for last one)
        if (i < SEARCH_QUERIES.length - 1) {
            console.log(`  ⏳ Waiting ${REQUEST_DELAY_MS / 1000}s (rate limit)...`);
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
        }
    }

    console.log(`📥 Total tweets fetched: ${allTweets.length}`);

    // Deduplicate by tweet ID
    const seen = new Set<string>();
    const uniqueTweets = allTweets.filter(tweet => {
        if (seen.has(tweet.id)) return false;
        seen.add(tweet.id);
        return true;
    });

    console.log(`🔄 After deduplication: ${uniqueTweets.length} tweets`);

    // Filter: recent, not matching negative filters
    const filteredTweets = uniqueTweets.filter(tweet => {
        // Check if recent (last 24 hours)
        if (!isRecent(tweet.createdAt)) {
            return false;
        }

        // Check negative filters
        if (matchesNegativeFilter(tweet.text)) {
            return false;
        }

        return true;
    });

    console.log(`✂️ After filtering: ${filteredTweets.length} tweets`);

    // Transform to RawPost format
    const posts = filteredTweets.map(transformToRawPost);

    console.log(`🎯 Returning ${posts.length} Twitter leads`);

    return posts;
}
