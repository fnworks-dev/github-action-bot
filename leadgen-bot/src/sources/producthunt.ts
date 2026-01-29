/**
 * Product Hunt Integration
 *
 * Fetches from Product Hunt's ecosystem, focusing on:
 * - Job listings (contract/project-based, not full-time)
 * - Maker discussions looking for developers
 * - Early-stage startups building MVPs
 *
 * API: Product Hunt GraphQL API (requires API token)
 * Fallback: Public job board scraping
 */

import type { RawPost } from '../types.js';

// Product Hunt GraphQL API
const PH_API_URL = 'https://api.producthunt.com/v2/api/graphql';
const PH_API_TOKEN = process.env.PRODUCTHUNT_API_TOKEN || '';

// Max age for posts (72 hours - PH job posts stay relevant longer)
const MAX_POST_AGE_MS = 72 * 60 * 60 * 1000;

// Keywords for project-based work (NOT full-time employment)
const PROJECT_KEYWORDS = [
    // Contract/Freelance indicators
    'contract',
    'freelance',
    'freelancer',
    'consultant',
    'consulting',
    'project based',
    'project-based',
    'part time',
    'part-time',
    'fractional',
    
    // Specific engagement types
    'mvp',
    'prototype',
    'poc', // proof of concept
    'integration',
    'migration',
    'redesign',
    'rebuild',
    'audit',
    
    // Time-bound
    '3 months',
    '6 months',
    '3-month',
    '6-month',
    'temporary',
    'short term',
    'short-term',
];

// Job titles that suggest project/contract work
const PROJECT_TITLES = [
    'contract developer',
    'freelance developer',
    'freelance engineer',
    'contract engineer',
    'technical consultant',
    'dev consultant',
    'fractional cto',
    'fractional developer',
    'project developer',
    'mvp developer',
];

// Negative filters - employment signals
const EMPLOYMENT_FILTERS = [
    'full time',
    'full-time',
    'fulltime',
    'permanent',
    'staff engineer',
    'senior engineer',
    'staff software',
    'employee',
    'join our team',
    'join us',
    'in-house',
    'inhouse',
    'on-site',
    'onsite',
    'relocation',
    'visa sponsorship',
    'benefits',
    '401k',
    'health insurance',
    'dental',
    'equity only', // Usually means no cash for project work
    'cofounder equity', // Equity-only cofounder roles
    'cofounder only',
];

// GraphQL query for job listings
const JOBS_QUERY = `
  query GetJobs($first: Int!) {
    jobs(first: $first) {
      edges {
        node {
          id
          title
          description
          url
          createdAt
          company {
            name
            slug
          }
          user {
            username
            name
          }
          location
          remote
          employmentType
        }
      }
    }
  }
`;

// GraphQL query for posts (discussions)
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
        }
      }
    }
  }
`;

interface PHCompany {
    name: string;
    slug: string;
}

interface PHUser {
    username: string;
    name: string;
}

interface PHJob {
    id: string;
    title: string;
    description: string;
    url: string;
    createdAt: string;
    company: PHCompany;
    user: PHUser;
    location: string;
    remote: boolean;
    employmentType: string;
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
}

interface PHJobsResponse {
    data?: {
        jobs?: {
            edges: Array<{ node: PHJob }>;
        };
    };
    errors?: Array<{ message: string }>;
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

// Check if job is project-based (not full-time)
function isProjectBasedJob(job: PHJob): boolean {
    const text = `${job.title} ${job.description || ''}`.toLowerCase();
    
    // Check employment type first
    const employmentType = (job.employmentType || '').toLowerCase();
    if (employmentType.includes('full') || employmentType.includes('permanent')) {
        return false;
    }
    
    // Check for project keywords
    const hasProjectKeyword = PROJECT_KEYWORDS.some(kw => 
        text.includes(kw.toLowerCase())
    );
    
    // Check for project-oriented titles
    const hasProjectTitle = PROJECT_TITLES.some(title => 
        text.includes(title.toLowerCase())
    );
    
    // Check for employment filters
    const isEmployment = EMPLOYMENT_FILTERS.some(filter => 
        text.includes(filter.toLowerCase())
    );
    
    // Must have project signals AND not be employment
    return (hasProjectKeyword || hasProjectTitle) && !isEmployment;
}

// Transform job to RawPost
function transformJobToRawPost(job: PHJob): RawPost {
    return {
        source: 'producthunt',
        sourceId: job.id,
        sourceUrl: job.url || `https://www.producthunt.com/jobs/${job.id}`,
        title: job.title,
        content: job.description || null,
        author: job.company?.name || job.user?.name || null,
        subreddit: job.remote ? 'Remote' : job.location || 'ProductHunt Jobs',
        postedAt: job.createdAt,
    };
}

// Transform post to RawPost (for discussion-based leads)
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

// Fetch jobs from Product Hunt API
async function fetchPHJobs(): Promise<PHJob[]> {
    if (!PH_API_TOKEN) {
        console.log('   ⚠️ ProductHunt API token not configured, skipping jobs...');
        return [];
    }

    const response = await fetch(PH_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${PH_API_TOKEN}`,
        },
        body: JSON.stringify({
            query: JOBS_QUERY,
            variables: { first: 50 },
        }),
    });

    if (!response.ok) {
        throw new Error(`ProductHunt API error: ${response.status}`);
    }

    const data: PHJobsResponse = await response.json();

    if (data.errors) {
        throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
    }

    return data.data?.jobs?.edges.map(edge => edge.node) || [];
}

// Fetch posts from Product Hunt API (for maker discussions)
async function fetchPHPosts(): Promise<PHPost[]> {
    if (!PH_API_TOKEN) {
        console.log('   ⚠️ ProductHunt API token not configured, skipping posts...');
        return [];
    }

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

// Check if post indicates developer need
function isDeveloperRelatedPost(post: PHPost): boolean {
    const text = `${post.name} ${post.tagline} ${post.description || ''}`.toLowerCase();
    
    const devKeywords = [
        'developer',
        'developer needed',
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
    ];
    
    return devKeywords.some(kw => text.includes(kw));
}

/**
 * Fetch project-based opportunities from Product Hunt
 * 
 * Combines:
 * 1. Job listings (filtered for contract/project work)
 * 2. Maker discussions looking for developers
 * 
 * Excludes full-time employment listings
 */
export async function fetchProductHuntPosts(): Promise<RawPost[]> {
    console.log('📡 Fetching from Product Hunt...');

    if (!PH_API_TOKEN) {
        console.log('   ⏭️ ProductHunt is disabled (no PRODUCTHUNT_API_TOKEN)');
        console.log('   💡 Get token at: https://www.producthunt.com/v2/oauth/applications');
        return [];
    }

    try {
        const allPosts: RawPost[] = [];

        // Fetch jobs
        console.log('   Fetching job listings...');
        const jobs = await fetchPHJobs();
        console.log(`   📥 ${jobs.length} jobs fetched`);

        // Filter for project-based jobs
        const projectJobs = jobs.filter(job => {
            if (!isPostFresh(job.createdAt)) return false;
            return isProjectBasedJob(job);
        });

        if (projectJobs.length > 0) {
            console.log(`   ✅ ${projectJobs.length} project-based jobs found`);
            allPosts.push(...projectJobs.map(transformJobToRawPost));
        }

        // Fetch posts (maker discussions)
        console.log('   Fetching maker discussions...');
        const posts = await fetchPHPosts();
        console.log(`   📥 ${posts.length} posts fetched`);

        // Filter for developer-related posts
        const devPosts = posts.filter(post => {
            if (!isPostFresh(post.createdAt)) return false;
            return isDeveloperRelatedPost(post);
        });

        if (devPosts.length > 0) {
            console.log(`   ✅ ${devPosts.length} developer-related discussions found`);
            allPosts.push(...devPosts.map(transformPostToRawPost));
        }

        // Deduplicate by ID
        const seen = new Set<string>();
        const uniquePosts = allPosts.filter(post => {
            if (seen.has(post.sourceId)) return false;
            seen.add(post.sourceId);
            return true;
        });

        console.log(`🎯 ${uniquePosts.length} total ProductHunt opportunities`);

        return uniquePosts;

    } catch (error) {
        console.error('❌ ProductHunt fetch failed:', error);
        return [];
    }
}
