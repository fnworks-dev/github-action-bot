import { validateConfig } from './config.js';
import { initDb, jobExists, insertJob, getStats, deleteOldPosts } from './db/turso.js';
import { fetchRedditPosts } from './sources/reddit.js';
/**
 * Process a single post - check for duplicates and insert if new
 */
async function processPost(post) {
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
    await insertJob(post, post.professions, null, // score - not used for job board
    post.summary, post.analysis);
    return true;
}
/**
 * Main processing function - fetch, categorize, and store jobs
 */
async function processJobs() {
    console.log('🚀 Starting job processing...');
    // Fetch all posts from Reddit (all professions)
    const posts = await fetchRedditPosts();
    let newJobsCount = 0;
    const byProfession = {
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
async function runCleanup() {
    console.log('');
    console.log('🧹 Running cleanup job...');
    try {
        const deletedCount = await deleteOldPosts();
        return deletedCount;
    }
    catch (error) {
        console.error('❌ Cleanup failed:', error);
        return 0;
    }
}
/**
 * Main entry point
 */
async function main() {
    console.log('🎮 SideQuest Bot starting...');
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log('');
    try {
        // Validate configuration
        validateConfig();
        console.log('✅ Configuration validated');
        console.log('');
        // Initialize database
        await initDb();
        console.log('');
        // Get initial stats
        const initialStats = await getStats();
        console.log('📊 Initial database stats:');
        console.log(`   Total jobs: ${initialStats.total}`);
        console.log(`   By status: new=${initialStats.byStatus.new}, processed=${initialStats.byStatus.processed}, archived=${initialStats.byStatus.archived}`);
        console.log('');
        // Process jobs
        const result = await processJobs();
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
        console.log('');
        console.log('📊 Final database stats:');
        const finalStats = await getStats();
        console.log(`   Total jobs: ${finalStats.total}`);
        console.log(`   By status: new=${finalStats.byStatus.new}, processed=${finalStats.byStatus.processed}, archived=${finalStats.byStatus.archived}`);
        console.log('');
        console.log('✅ SideQuest Bot completed successfully');
        console.log(`   Added: ${result.newJobs} new jobs`);
        console.log(`   Cleaned: ${deletedCount} old jobs`);
    }
    catch (error) {
        console.error('❌ SideQuest Bot error:', error);
        process.exit(1);
    }
}
// Run
main();
