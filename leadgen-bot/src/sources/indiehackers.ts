/**
 * IndieHackers Integration
 *
 * Fetches posts from IndieHackers community, focusing on:
 * - Non-technical founders looking for developers
 * - MVP building requests
 * - Cofounder searches
 * - Project-based work opportunities (not employment)
 *
 * API: IndieHackers GraphQL endpoint
 * Posts are public and can be filtered by keywords
 */

import type { RawPost } from '../types.js';
import { config } from '../config.js';

// IndieHackers GraphQL endpoint
const IH_GRAPHQL_URL = 'https://indiehackers.com/graphql';

// Max age for posts (48 hours - IH posts have longer shelf life)
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000;

// Keywords optimized for project-based work (NOT employment)
const PROJECT_KEYWORDS = [
    // MVP / Building
    'building mvp',
    'need mvp',
    'mvp developer',
    'build my mvp',
    'help me build',
    'need someone to build',
    
    // Technical partnership
    'technical cofounder',
    'tech cofounder',
    'technical co-founder',
    'looking for cofounder',
    'need technical partner',
    
    // Project-based (not hiring)
    'freelance developer',
    'contract developer',
    'project based',
    'need developer for project',
    'need dev for project',
    
    // Non-technical founder signals
    'non technical founder',
    'non-technical founder',
    'idea person',
    'business person',
    'have an idea',
    
    // SaaS/Startup building
    'building saas',
    'saas developer',
    'need saas built',
    'startup developer',
];

// Negative filters - skip employment posts
const EMPLOYMENT_FILTERS = [
    // Employment signals
    'hiring full time',
    'full time developer',
    'full-time developer',
    'join our team',
    'join us',
    'we are hiring',
    'position available',
    'job opening',
    'employment',
    'salary',
    'benefits',
    'in-house',
    'on-site',
    'onsite',
    
    // Self-promotion / For Hire
    '[for hire]',
    'i am a developer',
    "i'm a developer",
    'available for work',
    'looking for work',
    'seeking work',
    'hire me',
    'my portfolio',
    
    // Internship/Entry level
    'intern',
    'entry level',
    'entry-level',
    'junior developer',
];

// GraphQL query for fetching recent posts
const POSTS_QUERY = `
  query GetPosts($limit: Int!, $cursor: String) {
    posts(limit: $limit, cursor: $cursor) {
      items {
        id
        title
        body
        url
        createdAt
        user {
          id
          username
          fullName
        }
        group {
          id
          name
        }
      }
      cursor
      hasMore
    }
  }
`;

interface IHUser {
    id: string;
    username: string;
    fullName: string;
}

interface IHGroup {
    id: string;
    name: string;
}

interface IHPost {
    id: string;
    title: string;
    body: string;
    url: string;
    createdAt: string;
    user: IHUser;
    group: IHGroup | null;
}

interface IHResponse {
    data?: {
        posts?: {
            items: IHPost[];
            cursor: string | null;
            hasMore: boolean;
        };
    };
    errors?: Array<{ message: string }>;
}

// Check if post is fresh
function isPostFresh(postedAt: string): boolean {
    const postDate = new Date(postedAt);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// Check if post matches project-based keywords
function matchesProjectKeywords(title: string, body: string): boolean {
    const text = `${title} ${body || ''}`.toLowerCase();
    return PROJECT_KEYWORDS.some(keyword => text.includes(keyword.toLowerCase()));
}

// Check if post is employment (not project-based)
function isEmploymentPost(title: string, body: string): boolean {
    const text = `${title} ${body || ''}`.toLowerCase();
    return EMPLOYMENT_FILTERS.some(filter => text.includes(filter.toLowerCase()));
}

// Transform IndieHackers post to RawPost
function transformToRawPost(post: IHPost): RawPost {
    const postUrl = post.url || `https://indiehackers.com/post/${post.id}`;
    
    return {
        source: 'indiehackers',
        sourceId: post.id,
        sourceUrl: postUrl,
        title: post.title,
        content: post.body || null,
        author: post.user?.username || post.user?.fullName || null,
        subreddit: post.group?.name || null, // Using subreddit field for group name
        postedAt: post.createdAt,
    };
}

// Fetch posts from IndieHackers GraphQL API
async function fetchIHPosts(limit: number = 50): Promise<IHPost[]> {
    const response = await fetch(IH_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            query: POSTS_QUERY,
            variables: { limit },
        }),
    });

    if (!response.ok) {
        throw new Error(`IndieHackers API error: ${response.status}`);
    }

    const data: IHResponse = await response.json();

    if (data.errors) {
        throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
    }

    return data.data?.posts?.items || [];
}

/**
 * Fetch posts from IndieHackers
 * 
 * Filters for:
 * - Project-based work (MVP building, cofounder search)
 * - Excludes employment/job posts
 * - Recent posts only (48h)
 * 
 * @returns Array of project-based leads
 */
export async function fetchIndieHackersPosts(): Promise<RawPost[]> {
    console.log('📡 Fetching from IndieHackers...');

    try {
        // Fetch recent posts
        const posts = await fetchIHPosts(50);
        console.log(`📥 Fetched ${posts.length} posts from IndieHackers`);

        // Filter and transform
        const filteredPosts = posts.filter(post => {
            // Must be fresh
            if (!isPostFresh(post.createdAt)) {
                return false;
            }

            // Must have title
            if (!post.title?.trim()) {
                return false;
            }

            // Skip employment posts
            if (isEmploymentPost(post.title, post.body || '')) {
                return false;
            }

            // Must match project keywords
            return matchesProjectKeywords(post.title, post.body || '');
        });

        const results = filteredPosts.map(transformToRawPost);

        console.log(`🎯 ${results.length} project-based posts match criteria`);

        // Log matches for debugging
        if (results.length > 0) {
            console.log('   Found posts:');
            results.forEach(post => {
                console.log(`   - ${post.title.slice(0, 60)}...`);
            });
        }

        return results;

    } catch (error) {
        console.error('❌ IndieHackers fetch failed:', error);
        return [];
    }
}
