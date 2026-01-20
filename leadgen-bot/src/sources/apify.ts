/**
 * Apify Twitter/X Integration
 *
 * This is a placeholder for integrating Apify's Twitter scraper actors.
 * Apify provides managed Twitter scraping with proxy rotation and maintained
 * selectors, avoiding the issues we had with the DIY approach.
 *
 * Actor: https://apify.com/apify/twitter-scraper
 * Docs: https://docs.apify.com/actors
 */

import type { RawPost } from '../types.js';

// Configuration from environment
const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'apify/twitter-scraper';

// Search queries for hiring intent
const SEARCH_QUERIES = [
    'looking for developer',
    'hiring developer',
    'need developer',
    'looking for cofounder',
    'technical cofounder',
    'hire freelancer',
    'looking for agency',
];

// Negative filters - skip self-promotion
const NEGATIVE_FILTERS = [
    '[for hire]',
    'i am a developer',
    "i'm a developer",
    'i am available',
    'my portfolio',
    'hire me',
    'looking for work',
    'seeking work',
    'offering my services',
];

/**
 * Fetch tweets from Twitter/X using Apify
 *
 * @returns Array of raw posts matching hiring intent
 */
export async function fetchApifyPosts(): Promise<RawPost[]> {
    if (!APIFY_API_TOKEN) {
        console.log('⏭️ Apify is disabled (no APIFY_API_TOKEN), skipping...');
        return [];
    }

    console.log('📡 Fetching from Twitter/X via Apify...');

    try {
        const results: RawPost[] = [];

        for (const query of SEARCH_QUERIES) {
            console.log(`  Query: ${query}`);

            const response = await fetch(
                `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${APIFY_API_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        searchQueries: [query],
                        maxItems: 20,
                        tweetsDesired: 20,
                    }),
                }
            );

            if (!response.ok) {
                console.error(`  Apify error: ${response.status}`);
                continue;
            }

            const runInfo = await response.json();
            const runId = runInfo.data?.id;

            if (!runId) {
                console.error('  No run ID returned');
                continue;
            }

            // Wait for run to complete and get results
            const datasetId = await waitForRunCompletion(runId);
            if (datasetId) {
                const items = await getDatasetItems(datasetId);
                const posts = transformApifyToRawPost(items);
                results.push(...posts);
            }

            // Delay between queries
            await new Promise(r => setTimeout(r, 2000));
        }

        console.log(`📥 Fetched ${results.length} tweets from Apify`);
        return results;

    } catch (error) {
        console.error('❌ Apify fetch failed:', error);
        return [];
    }
}

/**
 * Wait for Apify run to complete
 */
async function waitForRunCompletion(runId: string, maxWaitSeconds = 120): Promise<string | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitSeconds * 1000) {
        const response = await fetch(
            `https://api.apify.com/v2/actor-runs/${runId}`,
            {
                headers: {
                    'Authorization': `Bearer ${APIFY_API_TOKEN}`,
                },
            }
        );

        if (!response.ok) {
            return null;
        }

        const runInfo = await response.json();
        const status = runInfo.data?.status;

        if (status === 'SUCCEEDED') {
            return runInfo.data?.defaultDatasetId || null;
        } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            console.error(`  Apify run ${status.toLowerCase()}`);
            return null;
        }

        await new Promise(r => setTimeout(r, 2000));
    }

    return null;
}

/**
 * Get items from Apify dataset
 */
async function getDatasetItems(datasetId: string): Promise<any[]> {
    const response = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items`,
        {
            headers: {
                'Authorization': `Bearer ${APIFY_API_TOKEN}`,
            },
        }
    );

    if (!response.ok) {
        return [];
    }

    return await response.json();
}

/**
 * Transform Apify tweet format to our RawPost format
 */
function transformApifyToRawPost(items: any[]): RawPost[] {
    return items
        .filter(item => {
            // Apply negative filters
            const text = (item.text || item.full_text || '').toLowerCase();
            return !NEGATIVE_FILTERS.some(filter => text.includes(filter));
        })
        .map(item => ({
            source: 'apify' as const,
            sourceId: item.id || item.tweet_id || '',
            sourceUrl: item.url || `https://x.com/i/web/status/${item.id}`,
            title: (item.text || item.full_text || '').slice(0, 100) + '...',
            content: item.text || item.full_text || null,
            author: item.username || item.user?.screen_name || item.author?.username || null,
            postedAt: item.created_at || item.timestamp || null,
        }));
}
