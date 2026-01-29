/**
 * Product Hunt Integration
 *
 * Fetches recent product launches from Product Hunt API
 * Posts are product launches that might need development services
 *
 * API: Product Hunt GraphQL API v2 (requires API token)
 */

import type { RawPost } from '../types.js';

// Product Hunt GraphQL API
const PH_API_URL = 'https://api.producthunt.com/v2/api/graphql';
const PH_API_TOKEN = process.env.PRODUCTHUNT_API_TOKEN || '';

// Max age for posts (72 hours)
const MAX_POST_AGE_MS = 72 * 60 * 60 * 1000;

// Keywords indicating potential client need
const CLIENT_KEYWORDS = [
    'mvp',
    'need developer',
    'looking for developer',
    'hiring developer',
    'technical cofounder',
    'tech cofounder',
    'cto needed',
    'need cto',
    'build app',
    'build saas',
    'need engineer',
    'development',
    'web app',
    'mobile app',
    'prototype',
];

// GraphQL query for recent posts
const POSTS_QUERY = `
  query GetPosts($first: Int!) {
    posts(first: $first) {
      edges {
        node {
          id
          name
          tagline
          description
          url
          createdAt
          user {
            username
            name
          }
          commentsCount
          votesCount
        }
      }
    }
  }
`;

interface PHUser {
    username: string;
    name: string;
}

interface PHPost {
    id: string;
    name: string;
    tagline: string;
    description: string;
    url: string;
    createdAt: string;
    user: PHUser;
    commentsCount: number;
    votesCount: number;
}

interface PHPostsResponse {
    data?: {
        posts?: {
            edges: Array<{ node: PHPost }>;
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

// Check if post indicates potential client need
function isClientRelatedPost(post: PHPost): boolean {
    const text = `${post.name} ${post.tagline} ${post.description || ''}`.toLowerCase();
    return CLIENT_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

// Transform post to RawPost
function transformPostToRawPost(post: PHPost): RawPost {
    const content = post.description || post.tagline || '';
    
    return {
        source: 'producthunt',
        sourceId: post.id,
        sourceUrl: post.url,
        title: post.name,
        content: content,
        author: post.user?.username || post.user?.name || null,
        subreddit: 'ProductHunt',
        postedAt: post.createdAt,
    };
}

// Fetch posts from Product Hunt API
async function fetchPHPosts(): Promise<PHPost[]> {
    const response = await fetch(PH_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${PH_API_TOKEN}`,
        },
        body: JSON.stringify({
            query: POSTS_QUERY,
            variables: { first: 50 },
        }),
    });

    if (!response.ok) {
        throw new Error(`ProductHunt API error: ${response.status}`);
    }

    const data: PHPostsResponse = await response.json();

    if (data.errors) {
        throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
    }

    return data.data?.posts?.edges.map(edge => edge.node) || [];
}

/**
 * Fetch recent product launches from Product Hunt
 */
export async function fetchProductHuntPosts(): Promise<RawPost[]> {
    console.log('📡 Fetching from Product Hunt...');

    if (!PH_API_TOKEN) {
        console.log('   ⏭️ ProductHunt is disabled (no PRODUCTHUNT_API_TOKEN)');
        console.log('   💡 Get token at: https://www.producthunt.com/v2/oauth/applications');
        return [];
    }

    try {
        console.log('   Fetching recent posts...');
        const posts = await fetchPHPosts();
        console.log(`   📥 ${posts.length} posts fetched`);

        // Filter for fresh, client-related posts
        const relevantPosts = posts.filter(post => {
            if (!isPostFresh(post.createdAt)) return false;
            return isClientRelatedPost(post);
        });

        console.log(`   ✅ ${relevantPosts.length} relevant posts found`);

        return relevantPosts.map(transformPostToRawPost);

    } catch (error) {
        console.error('❌ ProductHunt fetch failed:', error);
        return [];
    }
}
