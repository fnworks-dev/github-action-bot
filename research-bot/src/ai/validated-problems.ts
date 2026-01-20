import { getDb } from "../db/turso.js";
import type { Problem, ProblemCluster } from "../types.js";

/**
 * Generate validated problems with real user quotes
 * This is called by the bot during daily execution to pre-compute data
 */
export async function generateAndSaveValidatedProblems(): Promise<void> {
  const db = getDb();

  console.log("");
  console.log("🔥 Generating validated problems...");

  try {
    // Get all clusters ordered by validation level
    const clustersResult = await db.execute({
      sql: `
        SELECT * FROM problem_clusters
        ORDER BY CASE
          WHEN validation_level = 'HIGH' THEN 1
          WHEN validation_level = 'MEDIUM' THEN 2
          ELSE 3
        END, post_count DESC, avg_dev_score DESC
        LIMIT 10
      `,
      args: [],
    });

    const validatedProblems: any[] = [];

    // Collect all cluster IDs
    const clusterIds: string[] = [];
    const clusterMap = new Map<string, any>();

    for (const row of clustersResult.rows) {
      const clusterId = String(row.id);
      clusterIds.push(clusterId);
      clusterMap.set(clusterId, {
        id: clusterId,
        name: String(row.name),
        postCount: Number(row.post_count),
        avgDevScore: Number(row.avg_dev_score),
        validationLevel: String(row.validation_level),
        industries: parseJSONField(row.industries),
        aiSynthesis: row.ai_synthesis ? String(row.ai_synthesis) : null,
      });
    }

    if (clusterIds.length === 0) {
      console.log("   ⚠️  No clusters found");
      return;
    }

    // Get problem counts for all clusters
    const countResult = await db.execute({
      sql: `
        SELECT cluster_id, COUNT(*) as count
        FROM problems
        WHERE cluster_id IN (${clusterIds.map(() => '?').join(',')})
        GROUP BY cluster_id
      `,
      args: clusterIds,
    });

    const problemCounts = new Map<string, number>();
    for (const row of countResult.rows) {
      problemCounts.set(String(row.cluster_id), Number((row as any).count));
    }

    // Get top 5 quotes for each cluster
    const quotesByCluster = new Map<string, any[]>();

    for (const clusterId of clusterIds) {
      const quotesResult = await db.execute({
        sql: `
          SELECT id, title, pain_quote, source_url, subreddit, posted_at
          FROM problems
          WHERE cluster_id = ?
            AND pain_quote IS NOT NULL
            AND pain_quote != ''
          ORDER BY development_score DESC, posted_at DESC
          LIMIT 5
        `,
        args: [clusterId],
      });

      const topQuotes = quotesResult.rows.map((r: any) => ({
        quote: String(r.pain_quote),
        sourceUrl: String(r.source_url),
        subreddit: r.subreddit ? String(r.subreddit) : null,
        postedAt: r.posted_at ? String(r.posted_at) : null,
        title: String(r.title),
      }));

      if (topQuotes.length > 0) {
        quotesByCluster.set(clusterId, topQuotes);
      }
    }

    // Build final result
    for (const clusterId of clusterIds) {
      const cluster = clusterMap.get(clusterId)!;
      const topQuotes = quotesByCluster.get(clusterId) || [];
      const problemCount = problemCounts.get(clusterId) || cluster.postCount;

      // Skip clusters with no quotes
      if (topQuotes.length === 0) {
        continue;
      }

      // Simplified competition level (based on post count)
      let competitionLevel: "low" | "medium" | "high";
      if (cluster.postCount < 5) competitionLevel = "low";
      else if (cluster.postCount < 15) competitionLevel = "medium";
      else competitionLevel = "high";

      // Generate suggested solution (hybrid approach)
      let suggestedSolution: string;
      if (cluster.aiSynthesis && cluster.aiSynthesis.length > 10) {
        suggestedSolution = cluster.aiSynthesis;
      } else {
        if (cluster.industries.length > 0) {
          const topIndustries = cluster.industries.slice(0, 2).join(", ");
          suggestedSolution = `Automated ${cluster.name.toLowerCase()} for ${topIndustries}`;
        } else {
          suggestedSolution = `Automated ${cluster.name.toLowerCase()}`;
        }
      }

      validatedProblems.push({
        clusterId: cluster.id,
        name: cluster.name,
        postCount: cluster.postCount,
        avgDevScore: cluster.avgDevScore,
        validationLevel: cluster.validationLevel,
        competitionLevel,
        industries: cluster.industries,
        keywords: [],
        aiSynthesis: cluster.aiSynthesis,
        suggestedSolution,
        topQuotes,
        problemCount,
      });

      console.log(`   ✅ ${cluster.name}: ${topQuotes.length} quotes, ${problemCount} problems`);
    }

    // Save to database
    const today = new Date().toISOString().split("T")[0];
    const id = `validated_${today}`;
    const data = JSON.stringify(validatedProblems);

    await db.execute({
      sql: `
        INSERT INTO validated_problems (id, date, data)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data
      `,
      args: [id, today, data],
    });

    console.log(`   ✅ Saved ${validatedProblems.length} validated problems for ${today}`);
  } catch (error) {
    console.error("   ❌ Error generating validated problems:", error);
  }
}

// Helper function to parse JSON fields
function parseJSONField(val: unknown): string[] {
  if (!val) return [];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}
