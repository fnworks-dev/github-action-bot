import { config, validateConfig, isDailySummaryTime } from "./config.js";
import {
  initDb,
  problemExists,
  insertProblem,
  getTopProblemClusters,
  saveDailySummary,
  getDb,
  getAllClustersForIntelligence,
  getProblemsForAnalysis,
  saveDailyIntelligence,
} from "./db/turso.js";
import {
  generateClusters,
  getAllClusters,
  getProblemsByCluster,
  updateClusterSynthesis,
} from "./db/clusters.js";
import { fetchRedditPosts } from "./sources/reddit.js";
import { fetchHNPosts } from "./sources/hackernews.js";
import {
  analyzeBatch,
  generateClusterSynthesis,
  generateWeeklySummary,
} from "./ai/analyzer.js";
import { generateDailyIntelligence } from "./ai/daily-intelligence.js";
import { generateAndSaveValidatedProblems } from "./ai/validated-problems.js";
import {
  sendDailySummary,
  sendWeeklySummary,
} from "./notifications/discord.js";
import type { RawPost, Problem } from "./types.js";

async function processPostBatch(posts: RawPost[]): Promise<number> {
  if (posts.length === 0) return 0;

  console.log(`🔍 Analyzing batch of ${posts.length} posts...`);

  // Batch analyze with AI
  const results = await analyzeBatch(posts);

  let savedCount = 0;

  for (const result of results) {
    // Skip if no analysis (not a problem) or low relevance
    if (!result.analysis) continue;
    if (result.analysis.relevance < config.minRelevanceThreshold) continue;

    // Find the original post
    const post = posts.find((p) => p.sourceId === result.sourceId);
    if (!post) continue;

    // Check for duplicates (by URL)
    const exists = await problemExists(post.sourceUrl);
    if (exists) continue;

    // Insert into database
    try {
      await insertProblem(post, result.analysis);
      savedCount++;
      console.log(
        `   ✅ Saved: ${post.title.slice(0, 50)}... (dev: ${result.analysis.developmentScore})`,
      );
    } catch (error: any) {
      // URL unique constraint violation = duplicate
      if (!error.message?.includes("UNIQUE")) {
        console.error(`   ❌ Failed to save: ${error.message}`);
      }
    }
  }

  return savedCount;
}

async function main() {
  console.log("🚀 Problem Research Bot starting...");
  console.log(`⏰ Time: ${new Date().toISOString()}`);

  try {
    // Validate configuration
    validateConfig();
    console.log("✅ Configuration validated");

    // Initialize database
    await initDb();

    // Fetch posts from all sources
    const [redditPosts, hnPosts] = await Promise.all([
      fetchRedditPosts(),
      fetchHNPosts(),
    ]);

    const allPosts = [...redditPosts, ...hnPosts];
    const totalScanned = allPosts.length;
    console.log(`📦 Total posts to analyze: ${totalScanned}`);

    // Process in batches
    let totalSaved = 0;
    const batchSize = config.batchSize;

    for (let i = 0; i < allPosts.length; i += batchSize) {
      const batch = allPosts.slice(i, i + batchSize);
      const saved = await processPostBatch(batch);
      totalSaved += saved;

      // Delay between batches to avoid rate limiting
      if (i + batchSize < allPosts.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log("");
    console.log("📊 Run Summary:");
    console.log(`   Total scanned: ${totalScanned}`);
    console.log(`   Problems saved: ${totalSaved}`);

    // Generate clusters and auto-assign statuses
    console.log("");
    console.log("🔄 Generating clusters and auto-assigning statuses...");
    await generateClusters();

    // Generate AI synthesis for clusters that need it
    console.log("");
    console.log("🤖 Generating AI synthesis for clusters...");
    const clusters = await getAllClusters();
    let synthesisCount = 0;

    for (const cluster of clusters) {
      if (
        !cluster.aiSynthesis ||
        cluster.updatedAt <
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      ) {
        const problems = await getProblemsByCluster(cluster.id);
        if (problems.length >= 2) {
          const synthesis = await generateClusterSynthesis(
            cluster.name,
            problems,
          );
          if (synthesis) {
            await updateClusterSynthesis(cluster.id, synthesis);
            synthesisCount++;
            console.log(
              `   ✅ ${cluster.name}: ${synthesis.substring(0, 60)}...`,
            );
          }
        }
      }
    }

    if (synthesisCount === 0) {
      console.log("   ℹ️  All clusters have recent synthesis");
    } else {
      console.log(`   ✅ Generated ${synthesisCount} cluster syntheses`);
    }

    // Check if it's daily summary time (00:00 WIB = 17:00 UTC)
    if (isDailySummaryTime()) {
      console.log("");
      console.log("📨 Generating daily summary...");

      const today = new Date().toISOString().split("T")[0];
      const todayStart = `${today}T00:00:00.000Z`;

      const topProblems = await getTopProblemClusters(todayStart);

      // Save daily summary to database
      await saveDailySummary(today, totalScanned, totalSaved, topProblems);

      // Send to Discord
      await sendDailySummary(today, totalScanned, totalSaved, topProblems);

      // Phase 2: Generate AI-powered daily intelligence
      console.log("");
      console.log("🤖 Phase 2: Generating daily intelligence...");

      const allClusters = await getAllClustersForIntelligence();
      const allProblems = await getProblemsForAnalysis(50, 7);

      if (allClusters.length > 0 && allProblems.length > 0) {
        const intelligence = await generateDailyIntelligence(
          allClusters,
          allProblems,
        );

        // Save intelligence to database
        await saveDailyIntelligence(today, {
          buildSuggestion: intelligence.buildSuggestion,
          quickWins: intelligence.quickWins,
          marketOpportunities: allClusters,
          insights: intelligence.insights,
        });

        console.log("   ✅ Daily intelligence saved to database");

        // Phase 3: Generate validated problems with real user quotes
        console.log("");
        console.log("🔥 Phase 3: Generating validated problems...");
        await generateAndSaveValidatedProblems();
      } else {
        console.log("   ⚠️  Insufficient data for intelligence generation");
      }
    }

    // Weekly summary: the Monday (UTC) daily run
    const isMonday = new Date().getUTCDay() === 1;

    if (isMonday && isDailySummaryTime()) {
      console.log("");
      console.log("📅 Generating weekly summary...");

      const weekEnd = new Date().toISOString().split("T")[0];
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      // Get all clusters for weekly summary
      const clusters = await getAllClusters();
      const weekData = clusters
        .map((c) => ({
          cluster: c.name,
          posts: c.postCount,
          avgScore: c.avgDevScore,
          validation: c.validationLevel,
        }))
        .join("\n");

      const summary = await generateWeeklySummary(weekData);

      if (summary) {
        // Save weekly summary to database
        const db = getDb();
        const summaryId = crypto.randomUUID();
        await db.execute({
          sql: `INSERT INTO weekly_summaries (id, week_start, week_end, summary_data) VALUES (?, ?, ?, ?)`,
          args: [summaryId, weekStart, weekEnd, JSON.stringify(summary)],
        });

        // Send to Discord
        await sendWeeklySummary(weekStart, weekEnd, summary);

        console.log("   ✅ Weekly summary generated and sent");
      } else {
        console.log("   ⚠️  Weekly summary generation failed");
      }
    }

    console.log("✅ Problem Research Bot completed successfully");
  } catch (error) {
    console.error("❌ Problem Research Bot error:", error);
    process.exit(1);
  }
}

// Run
main();
