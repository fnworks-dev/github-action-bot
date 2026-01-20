#!/usr/bin/env tsx

/**
 * Migration Script: Add Bait Scores to Existing Posts
 *
 * This script:
 * 1. Fetches all existing problems from the database
 * 2. Runs bait detection on each post
 * 3. Updates the database with bait_score, bait_method, and bait_filtered
 *
 * Usage: npx tsx src/migrate-bait-scores.ts
 */

import { getDb } from "./db/turso.js";
import { detectBait } from "./ai/bait-detector.js";
import type { Problem } from "./types.js";

interface ProblemWithBait extends Problem {
  bait_score?: number;
  bait_method?: string | null;
  bait_filtered?: boolean;
}

async function migrateBaitScores() {
  console.log("🔄 Starting bait score migration...\n");

  const db = getDb();

  // Fetch all existing problems
  console.log("📊 Fetching existing problems from database...");
  const result = await db.execute("SELECT * FROM problems");

  const problems: ProblemWithBait[] = result.rows.map((row: any) => ({
    id: row.id as string,
    source: row.source as Problem["source"],
    sourceId: row.source_id as string,
    sourceUrl: row.source_url as string,
    title: row.title as string,
    content: row.content as string | null,
    author: row.author as string | null,
    subreddit: row.subreddit as string | null,
    relevance: row.relevance as number | null,
    severity: row.severity as number | null,
    developmentScore: row.development_score as number | null,
    problemCategory: row.problem_category as string | null,
    industry: row.industry as string | null,
    summary: row.summary as string | null,
    painQuote: row.pain_quote as string | null,
    competitors: row.competitors as string | null,
    status: row.status as Problem["status"],
    starred: Boolean(row.starred),
    notes: row.notes as string | null,
    clusterId: row.cluster_id as string | null,
    postedAt: row.posted_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    baitScore: (row.bait_score as number) || 0,
    baitMethod: row.bait_method as string | null,
    baitFiltered: Boolean(row.bait_filtered),
  }));

  console.log(`✅ Found ${problems.length} problems\n`);

  // Statistics
  let highBait = 0;
  let mediumBait = 0;
  let lowBait = 0;
  let clean = 0;
  let updated = 0;

  console.log("🔍 Running bait detection on each post...\n");

  // Process each problem
  for (let i = 0; i < problems.length; i++) {
    const problem = problems[i];

    // Skip if already has bait score
    if (problem.baitScore && problem.baitScore > 0) {
      console.log(
        `[${i + 1}/${problems.length}] ⏭️  Skipping "${problem.title.slice(0, 50)}..." (already has bait score: ${problem.baitScore})`,
      );

      // Count statistics
      if (problem.baitScore >= 70) highBait++;
      else if (problem.baitScore >= 40) mediumBait++;
      else if (problem.baitScore >= 20) lowBait++;
      else clean++;

      continue;
    }

    // Run bait detection
    const detection = detectBait({
      title: problem.title,
      content: problem.content,
      subreddit: problem.subreddit,
    });

    // Update database
    await db.execute({
      sql: `
        UPDATE problems
        SET bait_score = ?, bait_method = ?, bait_filtered = ?
        WHERE id = ?
      `,
      args: [
        detection.score,
        detection.method,
        detection.isBait ? 1 : 0,
        problem.id,
      ],
    });

    updated++;

    // Count statistics
    if (detection.score >= 70) {
      highBait++;
      console.log(
        `[${i + 1}/${problems.length}] 🚩 HIGH BAIT (${detection.score}/100): "${problem.title.slice(0, 50)}..."`,
      );
    } else if (detection.score >= 40) {
      mediumBait++;
      console.log(
        `[${i + 1}/${problems.length}] ⚠️  MEDIUM (${detection.score}/100): "${problem.title.slice(0, 50)}..."`,
      );
    } else if (detection.score >= 20) {
      lowBait++;
      console.log(
        `[${i + 1}/${problems.length}] 🔸 LOW (${detection.score}/100): "${problem.title.slice(0, 50)}..."`,
      );
    } else {
      clean++;
      console.log(
        `[${i + 1}/${problems.length}] ✅ CLEAN (${detection.score}/100): "${problem.title.slice(0, 50)}..."`,
      );
    }

    // Small delay to avoid overwhelming the database
    if (i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 MIGRATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total problems processed: ${problems.length}`);
  console.log(`Updated with bait scores: ${updated}`);
  console.log(`\nBait Score Distribution:`);
  console.log(
    `  🚩 High Bait (70-100): ${highBait} (${((highBait / problems.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  ⚠️  Medium Bait (40-69): ${mediumBait} (${((mediumBait / problems.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  🔸 Low Bait (20-39): ${lowBait} (${((lowBait / problems.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  ✅ Clean (0-19): ${clean} (${((clean / problems.length) * 100).toFixed(1)}%)`,
  );
  console.log("=".repeat(80));

  // Show sample of high bait posts
  console.log("\n🚨 SAMPLE HIGH BAIT POSTS (Top 5):");
  const highBaitPosts = problems
    .filter((p) => p.baitScore && p.baitScore >= 70)
    .slice(0, 5);
  if (highBaitPosts.length > 0) {
    highBaitPosts.forEach((post, index) => {
      console.log(`\n${index + 1}. "${post.title}"`);
      console.log(
        `   Score: ${post.baitScore}/100 | Subreddit: ${post.subreddit || post.source}`,
      );
      console.log(`   URL: ${post.sourceUrl}`);
    });
  } else {
    console.log("   No high bait posts found.");
  }

  console.log("\n✅ Migration complete!\n");
}

// Run the migration
migrateBaitScores().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exit(1);
});
