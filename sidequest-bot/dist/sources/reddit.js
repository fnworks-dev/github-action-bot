import Parser from 'rss-parser';
import { config, shouldFilterPost, getAllSubreddits } from '../config.js';
import { categorizePost, generateSummary } from '../ai/categorizer.js';
import { filterByHiringIntent } from '../ai/intent-detector.js';
import { analyzeJob } from '../ai/analyzer.js';
const REDDIT_USER_AGENT = 'script:fnworks.sidequest-bot:v1.1 (by /u/fnworks-dev)';
const REDDIT_JSON_LIMIT = 25;
const REDDIT_CLIENT_ID = process.env.SIDEQUEST_REDDIT_CLIENT_ID || process.env.REDDIT_CLIENT_ID || '';
const REDDIT_CLIENT_SECRET = process.env.SIDEQUEST_REDDIT_CLIENT_SECRET || process.env.REDDIT_CLIENT_SECRET || '';
let redditAccessToken = null;
let redditAccessTokenExpiresAt = 0;
let hasLoggedMissingOauthConfig = false;
// Create parser with custom headers to avoid 403
const parser = new Parser({
    headers: {
        'User-Agent': REDDIT_USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    timeout: 10000,
});
// Check if post is fresh (< 24h old)
function isPostFresh(postedAt) {
    if (!postedAt)
        return true;
    const postDate = new Date(postedAt);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < config.maxPostAgeMs;
}
// Check if content is just Reddit RSS boilerplate
function isBoilerplateContent(content) {
    if (!content)
        return true;
    const text = content.toLowerCase().trim();
    const boilerplatePatterns = ['submitted by', '[link]', '[comments]'];
    const hasBoilerplate = boilerplatePatterns.some((p) => text.includes(p));
    const isShort = text.length < 150;
    return hasBoilerplate && isShort;
}
// Parse Reddit JSON listing into RawPost entries
function parseRedditListing(subreddit, payload) {
    const children = payload?.data?.children;
    if (!Array.isArray(children)) {
        return [];
    }
    return children
        .map((child) => child?.data)
        .filter(Boolean)
        .map((post) => ({
        source: 'reddit',
        sourceId: typeof post.id === 'string'
            ? post.id
            : extractRedditId(post.permalink || post.url || ''),
        sourceUrl: typeof post.permalink === 'string'
            ? `https://www.reddit.com${post.permalink}`
            : (typeof post.url === 'string' ? post.url : ''),
        title: typeof post.title === 'string' ? post.title : '',
        content: typeof post.selftext === 'string' && post.selftext.trim().length > 0
            ? post.selftext
            : null,
        author: typeof post.author === 'string' ? post.author : null,
        subreddit: typeof post.subreddit === 'string' ? post.subreddit : subreddit,
        postedAt: typeof post.created_utc === 'number'
            ? new Date(post.created_utc * 1000).toISOString()
            : null,
    }))
        .filter((post) => post.title.trim().length > 0 && post.sourceUrl.trim().length > 0);
}
async function fetchSubredditJson(subreddit) {
    const endpoints = [];
    const oauthToken = await getRedditAccessToken();
    if (oauthToken) {
        endpoints.push({
            url: `https://oauth.reddit.com/r/${subreddit}/new?limit=${REDDIT_JSON_LIMIT}&raw_json=1`,
            authToken: oauthToken,
        });
    }
    endpoints.push({
        url: `https://api.reddit.com/r/${subreddit}/new?limit=${REDDIT_JSON_LIMIT}&raw_json=1`,
    });
    endpoints.push({
        url: `https://www.reddit.com/r/${subreddit}/new.json?limit=${REDDIT_JSON_LIMIT}&raw_json=1`,
    });
    let lastError = null;
    for (const endpoint of endpoints) {
        try {
            const headers = {
                'User-Agent': REDDIT_USER_AGENT,
                'Accept': 'application/json',
            };
            if (endpoint.authToken) {
                headers.Authorization = `Bearer ${endpoint.authToken}`;
            }
            const response = await fetch(endpoint.url, {
                headers: {
                    ...headers,
                },
            });
            if (!response.ok) {
                if (response.status === 401 && endpoint.authToken) {
                    redditAccessToken = null;
                    redditAccessTokenExpiresAt = 0;
                }
                throw new Error(`Status code ${response.status}`);
            }
            const payload = await response.json();
            return parseRedditListing(subreddit, payload);
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Unknown Reddit JSON fetch error');
}
async function getRedditAccessToken() {
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
        if (!hasLoggedMissingOauthConfig) {
            console.warn('⚠️ Reddit OAuth is not configured. Set SIDEQUEST_REDDIT_CLIENT_ID and SIDEQUEST_REDDIT_CLIENT_SECRET to improve Action-run fetch reliability.');
            hasLoggedMissingOauthConfig = true;
        }
        return null;
    }
    if (redditAccessToken && Date.now() < redditAccessTokenExpiresAt - 60_000) {
        return redditAccessToken;
    }
    const credentials = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'User-Agent': REDDIT_USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    if (!response.ok) {
        throw new Error(`OAuth token status ${response.status}`);
    }
    const payload = await response.json();
    if (!payload?.access_token) {
        throw new Error('OAuth token missing in Reddit response');
    }
    redditAccessToken = payload.access_token;
    const expiresIn = Number(payload.expires_in) || 3600;
    redditAccessTokenExpiresAt = Date.now() + expiresIn * 1000;
    console.log('🔐 Reddit OAuth token acquired');
    return redditAccessToken;
}
// Fetch posts from a single subreddit
async function fetchSubreddit(subreddit) {
    try {
        const posts = await fetchSubredditJson(subreddit);
        return posts;
    }
    catch (jsonError) {
        try {
            const url = `https://www.reddit.com/r/${subreddit}/new/.rss`;
            const feed = await parser.parseURL(url);
            return feed.items.map((item) => ({
                source: 'reddit',
                sourceId: extractRedditId(item.link || ''),
                sourceUrl: item.link || '',
                title: item.title || '',
                content: item.contentSnippet || item.content || null,
                author: item.creator || item.author || null,
                subreddit,
                postedAt: item.pubDate || null,
            }));
        }
        catch (rssError) {
            console.error(`Failed to fetch r/${subreddit}:`, jsonError);
            console.error(`Fallback RSS failed for r/${subreddit}:`, rssError);
            return [];
        }
    }
}
// Extract Reddit post ID from URL
function extractRedditId(url) {
    const match = url.match(/\/comments\/([a-z0-9]+)/i);
    if (match)
        return match[1];
    // Safe fallback: use simple hash
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return `reddit_${Math.abs(hash).toString(16)}`;
}
/**
 * Fetch all subreddits, filter, and categorize by profession
 */
export async function fetchRedditPosts() {
    const maxSubreddits = Math.max(1, Number.parseInt(process.env.SIDEQUEST_MAX_SUBREDDITS || '20', 10) || 20);
    const subreddits = getAllSubreddits().slice(0, maxSubreddits);
    console.log(`📡 Fetching from ${subreddits.length} subreddits...`);
    const allPosts = [];
    for (const subreddit of subreddits) {
        const posts = await fetchSubreddit(subreddit);
        allPosts.push(...posts);
        // Keep request pace moderate to reduce 429 responses in CI.
        await new Promise((resolve) => setTimeout(resolve, 900));
    }
    console.log(`📥 Fetched ${allPosts.length} total posts from Reddit`);
    // Step 1: Filter out posts with empty content or title
    const postsWithContent = allPosts.filter(post => post.title?.trim() && !isBoilerplateContent(post.content));
    console.log(`✂️ Filtered out ${allPosts.length - postsWithContent.length} posts with empty/boilerplate content`);
    // Step 2: Filter by time (< 24h old)
    const freshPosts = postsWithContent.filter(post => isPostFresh(post.postedAt));
    console.log(`⏰ ${freshPosts.length} posts are fresh (< 24h old)`);
    // Step 3: Apply negative filters (spam, self-promotion, etc.)
    const validPosts = freshPosts.filter(post => !shouldFilterPost(post.title, post.content || ''));
    console.log(`🚫 ${freshPosts.length - validPosts.length} posts filtered by negative filters`);
    // Step 3.5: Detect hiring intent (keyword + AI)
    console.log(`💼 Detecting hiring intent for ${validPosts.length} posts...`);
    const jobPosts = await filterByHiringIntent(validPosts);
    console.log(`💼 ${jobPosts.length} posts show hiring intent (filtered out ${validPosts.length - jobPosts.length} non-job posts)`);
    // Step 4: Categorize and analyze remaining posts by profession using AI
    console.log(`🏷️ Categorizing and analyzing ${jobPosts.length} posts...`);
    const enrichedPosts = [];
    for (const post of jobPosts) {
        try {
            const [categorization, summary, analysis] = await Promise.all([
                categorizePost(post.title, post.content),
                generateSummary(post.title, post.content),
                analyzeJob(post.title, post.content),
            ]);
            // Only include posts that matched at least one profession
            if (categorization.professions.length > 0) {
                enrichedPosts.push({
                    ...post,
                    professions: categorization.professions,
                    confidence: categorization.confidence,
                    summary,
                    analysis,
                });
            }
        }
        catch (error) {
            console.error(`Failed to categorize post: ${post.title.slice(0, 50)}...`, error);
        }
        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log(`✅ ${enrichedPosts.length} posts categorized with professions`);
    // Log profession distribution
    const professionCounts = {
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
export async function fetchPostsByProfession(professionKey) {
    const { professions: profs } = await import('../config.js');
    const profession = profs[professionKey];
    if (!profession) {
        throw new Error(`Unknown profession: ${professionKey}`);
    }
    console.log(`📡 Fetching posts for ${profession.name} from ${profession.subreddits.length} subreddits...`);
    const allPosts = [];
    for (const subreddit of profession.subreddits) {
        const posts = await fetchSubreddit(subreddit);
        allPosts.push(...posts);
        await new Promise((resolve) => setTimeout(resolve, 900));
    }
    console.log(`📥 Fetched ${allPosts.length} total posts for ${profession.name}`);
    // Apply same filtering pipeline
    const postsWithContent = allPosts.filter(post => post.title?.trim() && !isBoilerplateContent(post.content));
    const freshPosts = postsWithContent.filter(post => isPostFresh(post.postedAt));
    const validPosts = freshPosts.filter(post => !shouldFilterPost(post.title, post.content || ''));
    console.log(`✂️ Filtered to ${validPosts.length} valid posts for ${profession.name}`);
    // Detect hiring intent
    console.log(`💼 Detecting hiring intent for ${validPosts.length} posts...`);
    const jobPosts = await filterByHiringIntent(validPosts);
    console.log(`💼 ${jobPosts.length} posts show hiring intent for ${profession.name}`);
    // Categorize and analyze with AI (will confirm the profession match)
    console.log(`🏷️ Categorizing and analyzing ${jobPosts.length} posts...`);
    const enrichedPosts = [];
    for (const post of jobPosts) {
        try {
            const [categorization, summary, analysis] = await Promise.all([
                categorizePost(post.title, post.content),
                generateSummary(post.title, post.content),
                analyzeJob(post.title, post.content),
            ]);
            // Only include if this post matches the requested profession
            if (categorization.professions.includes(professionKey)) {
                enrichedPosts.push({
                    ...post,
                    professions: categorization.professions,
                    confidence: categorization.confidence,
                    summary,
                    analysis,
                });
            }
        }
        catch (error) {
            console.error(`Failed to categorize post: ${post.title.slice(0, 50)}...`, error);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log(`✅ ${enrichedPosts.length} posts matched ${profession.name}`);
    return enrichedPosts;
}
