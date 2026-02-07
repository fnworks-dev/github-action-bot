import { config, validateConfig } from './config.js';
import {
    initDb,
    jobExists,
    insertJob,
    getStats,
    deleteOldPosts,
    getLatestJobCreatedAt,
    startSidequestRun,
    updateSidequestRunStage,
    completeSidequestRunSuccess,
    completeSidequestRunFailure,
} from './db/turso.js';
import { fetchRedditPosts } from './sources/reddit.js';
import type { EnrichedPost } from './sources/reddit.js';
import type { Profession, SidequestRunStage } from './types.js';

interface ProcessResult {
    fetched: number;
    newJobs: number;
    byProfession: Record<Profession, number>;
}

const DEFAULT_STALE_FAIL_HOURS = 72;

/**
 * Process a single post - check for duplicates and insert if new
 */
async function processPost(post: EnrichedPost): Promise<boolean> {
    // Check if already processed
    const exists = await jobExists(post.source, post.sourceId);
    if (exists) {
        return false;
    }

    console.log(`📝 New job: ${post.title.slice(0, 60)}...`);
    console.log(`   Professions: ${post.professions.join(', ')}`);
    console.log(`   Confidence: ${(post.confidence * 100).toFixed(0)}%`);
    
    if (post.analysis?.project_type) {
        console.log(`   Project: ${post.analysis.project_type}`);
    }
    if (post.analysis?.tech_stack?.length) {
        console.log(`   Tech: ${post.analysis.tech_stack.join(', ')}`);
    }

    // Insert into database with analysis
    await insertJob(
        post,
        post.professions,
        null, // score - not used for job board
        post.summary,
        post.analysis
    );

    return true;
}

/**
 * Main processing function - fetch, categorize, and store jobs
 */
async function processJobs(onFetchComplete?: (count: number) => void): Promise<ProcessResult> {
    console.log('🚀 Starting job processing...');

    // Fetch all posts from Reddit (all professions)
    const posts = await fetchRedditPosts();
    onFetchComplete?.(posts.length);

    let newJobsCount = 0;
    const byProfession: Record<Profession, number> = {
        developer: 0,
        artist: 0,
        'voice-actor': 0,
        'video-editor': 0,
        writer: 0,
        audio: 0,
        qa: 0,
        'virtual-assistant': 0,
    };

    // Process each post
    for (const post of posts) {
        const isNew = await processPost(post);

        if (isNew) {
            newJobsCount++;

            // Count by profession (post can have multiple)
            for (const prof of post.professions) {
                byProfession[prof]++;
            }
        }
    }

    return {
        fetched: posts.length,
        newJobs: newJobsCount,
        byProfession,
    };
}

/**
 * Run cleanup job - delete posts older than 30 days
 */
async function runCleanup(): Promise<number> {
    console.log('');
    console.log('🧹 Running cleanup job...');

    try {
        const deletedCount = await deleteOldPosts();
        return deletedCount;
    } catch (error) {
        console.error('❌ Cleanup failed:', error);
        return 0;
    }
}

function parseStaleFailHours(): number {
    const raw = process.env.SIDEQUEST_STALE_FAIL_HOURS;
    if (!raw) {
        return DEFAULT_STALE_FAIL_HOURS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        console.warn(
            `⚠️ Invalid SIDEQUEST_STALE_FAIL_HOURS="${raw}", using default ${DEFAULT_STALE_FAIL_HOURS}`
        );
        return DEFAULT_STALE_FAIL_HOURS;
    }
    return parsed;
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack || error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return JSON.stringify(error);
}

function maskDbHost(url: string): string {
    try {
        const host = new URL(url.replace(/^libsql:\/\//, 'https://')).hostname;
        const [first, ...rest] = host.split('.');
        const maskedPrefix = first.length > 6 ? `${first.slice(0, 3)}***${first.slice(-2)}` : `${first.slice(0, 1)}***`;
        return `${maskedPrefix}.${rest.join('.')}`;
    } catch {
        return 'unknown-host';
    }
}

async function verifyFreshnessOrThrow(latestCreatedAt: string | null, staleFailHours: number): Promise<void> {
    if (!latestCreatedAt) {
        throw new Error('Freshness check failed: job_posts has no created_at value');
    }

    const latestDate = new Date(latestCreatedAt);
    if (Number.isNaN(latestDate.getTime())) {
        throw new Error(`Freshness check failed: invalid latest created_at "${latestCreatedAt}"`);
    }

    const ageHours = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60);
    console.log(`🕒 Latest job age: ${ageHours.toFixed(2)}h (threshold: ${staleFailHours}h)`);

    if (ageHours > staleFailHours) {
        throw new Error(
            `Freshness check failed: latest job is ${ageHours.toFixed(2)}h old (threshold ${staleFailHours}h)`
        );
    }
}

async function logStage(stage: SidequestRunStage, runRecordId: string | null): Promise<void> {
    console.log(`📍 MILESTONE ${stage}`);
    if (!runRecordId) {
        return;
    }
    await updateSidequestRunStage(runRecordId, stage);
}

process.on('uncaughtException', (error) => {
    console.error('❌ Fatal uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Fatal unhandled rejection:', reason);
    process.exit(1);
});

/**
 * Main entry point
 */
async function main() {
    const startedAtMs = Date.now();
    const staleFailHours = parseStaleFailHours();
    const githubRunId = process.env.GITHUB_RUN_ID || null;
    const trigger = process.env.GITHUB_EVENT_NAME || 'local';
    let runRecordId: string | null = null;
    let latestBefore: string | null = null;
    let latestAfter: string | null = null;
    let result: ProcessResult = {
        fetched: 0,
        newJobs: 0,
        byProfession: {
            developer: 0,
            artist: 0,
            'voice-actor': 0,
            'video-editor': 0,
            writer: 0,
            audio: 0,
            qa: 0,
            'virtual-assistant': 0,
        },
    };
    let finalStage: SidequestRunStage = 'BOOT';

    console.log('🎮 SideQuest Bot starting...');
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log(`🔁 Trigger: ${trigger} ${githubRunId ? `(run ${githubRunId})` : '(local run)'}`);
    console.log(`🗃️ DB Host: ${maskDbHost(config.turso.url)}`);
    console.log('');

    try {
        // Validate configuration
        validateConfig();
        await logStage('CONFIG_VALIDATED', runRecordId);
        finalStage = 'CONFIG_VALIDATED';

        // Initialize database
        await initDb();
        await logStage('DB_INITIALIZED', runRecordId);
        finalStage = 'DB_INITIALIZED';

        latestBefore = await getLatestJobCreatedAt();
        runRecordId = await startSidequestRun({
            githubRunId,
            trigger,
            stage: 'RUN_TRACKING_STARTED',
            latestJobCreatedAtBefore: latestBefore,
        });
        await logStage('RUN_TRACKING_STARTED', runRecordId);
        finalStage = 'RUN_TRACKING_STARTED';

        // Get initial stats
        const initialStats = await getStats();
        await logStage('INITIAL_STATS_LOADED', runRecordId);
        finalStage = 'INITIAL_STATS_LOADED';

        console.log('📊 Initial database stats:');
        console.log(`   Total jobs: ${initialStats.total}`);
        console.log(`   By status: new=${initialStats.byStatus.new}, processed=${initialStats.byStatus.processed}, archived=${initialStats.byStatus.archived}`);
        console.log(`   Latest created_at before run: ${latestBefore ?? 'NULL'}`);
        console.log('');

        // Process jobs
        await logStage('FETCH_STARTED', runRecordId);
        finalStage = 'FETCH_STARTED';
        result = await processJobs((fetchedCount) => {
            console.log(`📦 Fetch complete: ${fetchedCount} candidate posts`);
        });
        await logStage('FETCH_COMPLETED', runRecordId);
        finalStage = 'FETCH_COMPLETED';
        await logStage('PROCESS_COMPLETED', runRecordId);
        finalStage = 'PROCESS_COMPLETED';

        console.log('');
        console.log('📊 Processing results:');
        console.log(`   Fetched: ${result.fetched} posts`);
        console.log(`   New jobs: ${result.newJobs}`);
        console.log('   By profession:');
        for (const [prof, count] of Object.entries(result.byProfession)) {
            if (count > 0) {
                console.log(`      ${prof}: ${count}`);
            }
        }

        // Run cleanup job
        const deletedCount = await runCleanup();
        await logStage('CLEANUP_COMPLETED', runRecordId);
        finalStage = 'CLEANUP_COMPLETED';

        console.log('');
        console.log('📊 Final database stats:');
        const finalStats = await getStats();
        latestAfter = await getLatestJobCreatedAt();
        console.log(`   Total jobs: ${finalStats.total}`);
        console.log(`   By status: new=${finalStats.byStatus.new}, processed=${finalStats.byStatus.processed}, archived=${finalStats.byStatus.archived}`);
        console.log(`   Latest created_at after run: ${latestAfter ?? 'NULL'}`);
        console.log('');

        await verifyFreshnessOrThrow(latestAfter, staleFailHours);
        await logStage('FRESHNESS_VALIDATED', runRecordId);
        finalStage = 'FRESHNESS_VALIDATED';

        if (!runRecordId) {
            throw new Error('Missing run tracking record ID');
        }
        await completeSidequestRunSuccess(runRecordId, {
            fetchedCount: result.fetched,
            newJobsCount: result.newJobs,
            stage: 'RUN_COMPLETED',
            latestJobCreatedAtAfter: latestAfter,
        });

        await logStage('RUN_COMPLETED', runRecordId);
        finalStage = 'RUN_COMPLETED';

        console.log('✅ SideQuest Bot completed successfully');
        console.log(`   Added: ${result.newJobs} new jobs`);
        console.log(`   Cleaned: ${deletedCount} old jobs`);
    } catch (error) {
        finalStage = 'FAILED';
        const errorMessage = normalizeError(error);
        console.error('❌ SideQuest Bot error:', errorMessage);

        if (runRecordId) {
            try {
                await completeSidequestRunFailure(runRecordId, 'FAILED', errorMessage);
            } catch (trackingError) {
                console.error('❌ Failed to persist run failure status:', normalizeError(trackingError));
            }
        }
        process.exitCode = 1;
        return;
    } finally {
        const elapsedMs = Date.now() - startedAtMs;
        console.log(`⏱️ Runtime: ${elapsedMs}ms`);
        console.log(`🏁 Final stage: ${finalStage}`);
        if (finalStage !== 'RUN_COMPLETED') {
            console.error(`❌ Incomplete execution detected at stage ${finalStage}`);
        }
    }
}

// Run
await main();
