import 'dotenv/config';
import { config, validateConfig } from './config.js';
import { initDb, leadExists, insertLead, markNotified } from './db/turso.js';
import { fetchRedditPosts } from './sources/reddit.js';
import { fetchHNPosts } from './sources/hackernews.js';
import { fetchTwitterApiPosts } from './sources/twitterapi.js';
import { fetchTwitterDiyPosts } from './sources/twitter-diy.js';
import { fetchIndieHackersPosts } from './sources/indiehackers.js';
import { fetchProductHuntPosts } from './sources/producthunt.js';
import { scorePost } from './ai/scorer.js';
import {
    sendDiscordNotification,
    sendSummaryNotification,
} from './notifications/discord.js';
import type { RawPost, Lead } from './types.js';

async function processPost(post: RawPost): Promise<Lead | null> {
    // Check if already processed
    const exists = await leadExists(post.source, post.sourceId);
    if (exists) {
        return null;
    }

    console.log(`🔍 Scoring: ${post.title.slice(0, 60)}...`);

    // Score with AI
    const scoring = await scorePost(post);

    // Insert into database
    const id = await insertLead(
        post,
        scoring.score,
        scoring.summary,
        scoring.suggestedReply
    );

    return {
        id,
        source: post.source,
        sourceId: post.sourceId,
        sourceUrl: post.sourceUrl,
        title: post.title,
        content: post.content,
        author: post.author,
        subreddit: post.subreddit || null,
        score: scoring.score,
        summary: scoring.summary,
        suggestedReply: scoring.suggestedReply,
        status: 'new',
        notes: null,
        postedAt: post.postedAt,
        notifiedAt: null,
        contactedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

async function main() {
    console.log('🚀 Lead Bot starting...');
    console.log(`⏰ Time: ${new Date().toISOString()}`);

    try {
        // Validate configuration
        validateConfig();
        console.log('✅ Configuration validated');

        // Initialize database
        await initDb();

        // Check which sources to run (default: all)
        const sourcesEnv = process.env.SOURCES || 'reddit,hackernews,twitter';
        const enabledSources = sourcesEnv.split(',').map(s => s.trim().toLowerCase());
        console.log(`📋 Enabled sources: ${enabledSources.join(', ')}`);

        // Build list of source fetchers based on SOURCES env var
        const sourceFetchers: Array<{ name: string; fetcher: () => Promise<RawPost[]> }> = [];

        if (enabledSources.includes('reddit')) {
            sourceFetchers.push({ name: 'Reddit', fetcher: fetchRedditPosts });
        }
        if (enabledSources.includes('hackernews') || enabledSources.includes('hn')) {
            sourceFetchers.push({ name: 'HackerNews', fetcher: fetchHNPosts });
        }
        if (enabledSources.includes('twitter') || enabledSources.includes('x')) {
            // Choose Twitter source based on configuration
            if (config.twitter.source === 'diy') {
                sourceFetchers.push({ name: 'Twitter (DIY)', fetcher: fetchTwitterDiyPosts });
            } else {
                sourceFetchers.push({ name: 'Twitter (API)', fetcher: fetchTwitterApiPosts });
            }
        }
        if (enabledSources.includes('indiehackers') || enabledSources.includes('ih')) {
            sourceFetchers.push({ name: 'IndieHackers', fetcher: fetchIndieHackersPosts });
        }
        if (enabledSources.includes('producthunt') || enabledSources.includes('ph')) {
            sourceFetchers.push({ name: 'ProductHunt', fetcher: fetchProductHuntPosts });
        }

        if (sourceFetchers.length === 0) {
            console.log('⚠️ No sources enabled, exiting...');
            return;
        }

        // Fetch posts from enabled sources with error isolation
        console.log(`📡 Fetching from ${sourceFetchers.length} source(s)...`);
        const sourceResults = await Promise.allSettled(
            sourceFetchers.map(s => s.fetcher())
        );

        // Extract results and log failures
        const allPosts: RawPost[] = [];
        for (let i = 0; i < sourceResults.length; i++) {
            const result = sourceResults[i];
            const sourceName = sourceFetchers[i].name;

            if (result.status === 'fulfilled') {
                allPosts.push(...result.value);
            } else {
                console.error(`❌ ${sourceName} fetch failed:`, result.reason);
            }
        }

        console.log(`📦 Total posts to process: ${allPosts.length}`);

        let newLeadsCount = 0;
        let notifiedCount = 0;
        const processedLeads: Lead[] = [];

        // Process each post
        for (const post of allPosts) {
            const lead = await processPost(post);

            if (lead) {
                newLeadsCount++;
                processedLeads.push(lead);

                // Notify if score is above threshold
                if (lead.score && lead.score >= config.minScoreThreshold) {
                    const sent = await sendDiscordNotification(lead);
                    if (sent) {
                        await markNotified(lead.id);
                        notifiedCount++;
                    }
                }

                // Delay between API calls to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        }

        // Send detailed summary with all leads
        await sendSummaryNotification(allPosts.length, newLeadsCount, notifiedCount, processedLeads);

        console.log('');
        console.log('📊 Run Summary:');
        console.log(`   Total fetched: ${allPosts.length}`);
        console.log(`   New leads: ${newLeadsCount}`);
        console.log(`   Notified: ${notifiedCount}`);
        console.log('✅ Lead Bot completed successfully');
    } catch (error) {
        console.error('❌ Lead Bot error:', error);
        process.exit(1);
    }
}

// Run
main();
