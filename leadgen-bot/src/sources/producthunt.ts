/**
 * Product Hunt Integration
 *
 * Fetches recent product launches from Product Hunt API
 */

import type { RawPost } from '../types.js';

const PH_API_URL = 'https://api.producthunt.com/v2/api/graphql';
const PH_API_TOKEN = process.env.PRODUCTHUNT_API_TOKEN || '';

// Max age for posts (7 days - ProductHunt has less volume)
const MAX_POST_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
          votesCount
        }
      }
    }
  }
`;

interface PHPost {
    id: string;
    name: string;
    tagline: string;
    description: string;
    url: string;
    createdAt: string;
    user: {
        username: string;
        name: string;
    };
    votesCount: number;
}

// Check if post is fresh
function isPostFresh(postedAt: string): boolean {
    const postDate = new Date(postedAt);
    const now = new Date();
    return (now.getTime() - postDate.getTime()) < MAX_POST_AGE_MS;
}

// Transform post to RawPost
function transformPostToRawPost(post: PHPost): RawPost {
    return {
        source: 'producthunt',
        sourceId: post.id,
        sourceUrl: post.url,
        title: post.name,
        content: post.tagline || post.description || '',
        author: post.user?.username || post.user?.name || null,
        subreddit: 'ProductHunt',
        postedAt: post.createdAt,
    };
}

/**
 * Fetch recent product launches from Product Hunt
 */
export async function fetchProductHuntPosts(): Promise<RawPost[]> {
    console.log('📡 Fetching from Product Hunt...');

    if (!PH_API_TOKEN) {
        console.log('   ⏭️ ProductHunt is disabled (no PRODUCTHUNT_API_TOKEN)');
        return [];
    }

    try {
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

        const data = await response.json();

        if (data.errors) {
            throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
        }

        const posts: PHPost[] = data.data?.posts?.edges.map((edge: {node: PHPost}) => edge.node) || [];
        console.log(`   📥 ${posts.length} posts fetched`);

        // Filter fresh posts only (no keyword filtering - ProductHunt is low volume)
        const freshPosts = posts.filter(post => isPostFresh(post.createdAt));
        console.log(`   ✅ ${freshPosts.length} fresh posts found`);

        return freshPosts.map(transformPostToRawPost);

    } catch (error) {
        console.error('❌ ProductHunt fetch failed:', error);
        return [];
    }
}
