import { createClient, type Client } from "@libsql/client";
import { config } from "../config.js";
import type {
  Problem,
  RawPost,
  ProblemStatus,
  AnalysisResult,
  DailySummary,
  TopProblemCluster,
  ProblemCluster,
  WeeklySummary,
} from "../types.js";

let client: Client | null = null;

/**
 * Retry wrapper for Turso database operations
 * Retries on transient errors (HTTP 400, 429, 500) with exponential backoff
 *
 * @param fn - Async function to execute
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Result of the function execution
 * @throws Error if all retries are exhausted
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRetryable = error?.code === 'SERVER_ERROR' ||
                          error?.status === 400 ||
                          error?.status === 429 ||
                          error?.status === 500;
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Operation failed after retries');
}

export function getDb(): Client {
  if (!client) {
    client = createClient({
      url: config.turso.url,
      authToken: config.turso.authToken,
    });
  }
  return client;
}

// Initialize database schema
export async function initDb(): Promise<void> {
  const db = getDb();

  await db.batch(
    [
      // Problems table
      `CREATE TABLE IF NOT EXISTS problems (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_url TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          content TEXT,
          author TEXT,
          subreddit TEXT,
          relevance INTEGER,
          severity INTEGER,
          development_score INTEGER,
          problem_category TEXT,
          industry TEXT,
          summary TEXT,
          pain_quote TEXT,
          competitors TEXT,
          status TEXT DEFAULT 'new',
          starred INTEGER DEFAULT 0,
          notes TEXT,
          cluster_id TEXT,
          posted_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          bait_score INTEGER DEFAULT 0,
          bait_method TEXT,
          bait_filtered INTEGER DEFAULT 0
        )`,
      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_problems_source ON problems(source, source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_problems_status ON problems(status)`,
      `CREATE INDEX IF NOT EXISTS idx_problems_dev_score ON problems(development_score DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_problems_category ON problems(problem_category)`,
      `CREATE INDEX IF NOT EXISTS idx_problems_industry ON problems(industry)`,
      `CREATE INDEX IF NOT EXISTS idx_problems_starred ON problems(starred)`,
      `CREATE INDEX IF NOT EXISTS idx_problems_created ON problems(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_problems_cluster_id ON problems(cluster_id)`,
      // Problem clusters table
      `CREATE TABLE IF NOT EXISTS problem_clusters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          keywords TEXT,
          post_count INTEGER DEFAULT 0,
          avg_dev_score REAL,
          validation_level TEXT,
          ai_synthesis TEXT,
          industries TEXT,
          best_quotes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
      `CREATE INDEX IF NOT EXISTS idx_clusters_validation ON problem_clusters(validation_level)`,
      `CREATE INDEX IF NOT EXISTS idx_clusters_count ON problem_clusters(post_count DESC)`,
      // Daily summaries table
      `CREATE TABLE IF NOT EXISTS daily_summaries (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL UNIQUE,
          total_scanned INTEGER,
          problems_found INTEGER,
          top_problems TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
      // Weekly summaries table
      `CREATE TABLE IF NOT EXISTS weekly_summaries (
          id TEXT PRIMARY KEY,
          week_start TEXT NOT NULL UNIQUE,
          week_end TEXT NOT NULL UNIQUE,
          summary_data TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
      // Validated problems table (pre-computed daily)
      `CREATE TABLE IF NOT EXISTS validated_problems (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
    "write",
  );

  console.log("✅ Database initialized");

  // Run Phase 2 migration (add daily intelligence columns)
  await migratePhase2Columns();
}

/**
 * Migration: Add Phase 2 columns to daily_summaries table
 * This function is safe to run multiple times - it checks if columns exist first
 */
async function migratePhase2Columns(): Promise<void> {
  const db = getDb();

  try {
    // Check if build_suggestion column exists
    const checkResult = await db.execute({
      sql: `PRAGMA table_info(daily_summaries)`,
      args: [],
    });

    const existingColumns = new Set(
      checkResult.rows.map((row: any) => row.name as string),
    );

    const columnsToAdd = [
      "build_suggestion",
      "quick_wins",
      "market_opportunities",
      "insights",
      "generated_at",
    ];

    for (const column of columnsToAdd) {
      if (!existingColumns.has(column)) {
        console.log(`  ➕ Adding column: ${column}...`);
        await db.execute({
          sql: `ALTER TABLE daily_summaries ADD COLUMN ${column} TEXT`,
          args: [],
        });
      }
    }

    console.log("✅ Phase 2 migration completed");
  } catch (error: any) {
    // If migration fails, log but don't crash
    if (error.message?.includes("duplicate column")) {
      console.log("  ℹ️  Phase 2 columns already exist");
    } else {
      console.error("  ⚠️  Phase 2 migration failed:", error.message);
    }
  }
}

// Check if problem already exists (by URL for deduplication)
export async function problemExists(sourceUrl: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT 1 FROM problems WHERE source_url = ?",
    args: [sourceUrl],
  });
  return result.rows.length > 0;
}

// Insert new problem
export async function insertProblem(
  post: RawPost,
  analysis: AnalysisResult,
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();

  // Run bait detection before saving
  const { detectBait } = await import("../ai/bait-detector.js");
  const baitDetection = detectBait({
    title: post.title,
    content: post.content,
    subreddit: post.subreddit ?? null,
  });

  await db.execute({
    sql: `
      INSERT INTO problems (
        id, source, source_id, source_url, title, content, author, subreddit,
        relevance, severity, development_score, problem_category, industry,
        summary, pain_quote, competitors, posted_at, bait_score, bait_method, bait_filtered
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      post.source,
      post.sourceId,
      post.sourceUrl,
      post.title,
      post.content,
      post.author,
      post.subreddit ?? null,
      analysis.relevance,
      analysis.severity,
      analysis.developmentScore,
      analysis.problemCategory,
      analysis.industry,
      analysis.summary,
      analysis.painQuote,
      analysis.competitors,
      post.postedAt ?? null,
      baitDetection.score,
      baitDetection.method,
      baitDetection.isBait ? 1 : 0,
    ],
  });

  return id;
}

// Update problem status
export async function updateProblemStatus(
  id: string,
  status: ProblemStatus,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE problems SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [status, id],
  });
}

// Toggle starred
export async function toggleStarred(id: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE problems SET starred = NOT starred, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [id],
  });
}

// Get all problems with optional filters
export async function getProblems(filters?: {
  status?: ProblemStatus;
  category?: string;
  industry?: string;
  starred?: boolean;
  minDevScore?: number;
}): Promise<Problem[]> {
  const db = getDb();
  let sql = "SELECT * FROM problems";
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (filters?.status) {
    conditions.push("status = ?");
    args.push(filters.status);
  }
  if (filters?.category) {
    conditions.push("problem_category = ?");
    args.push(filters.category);
  }
  if (filters?.industry) {
    conditions.push("industry = ?");
    args.push(filters.industry);
  }
  if (filters?.starred) {
    conditions.push("starred = 1");
  }
  if (filters?.minDevScore) {
    conditions.push("development_score >= ?");
    args.push(filters.minDevScore);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY development_score DESC, created_at DESC LIMIT 200";

  const result = await db.execute({ sql, args });

  return result.rows.map(mapRowToProblem);
}

// Get problems by category for clustering
export async function getProblemsByCategory(): Promise<Map<string, Problem[]>> {
  const db = getDb();
  const result = await db.execute(
    "SELECT * FROM problems WHERE problem_category IS NOT NULL ORDER BY development_score DESC",
  );

  const grouped = new Map<string, Problem[]>();
  for (const row of result.rows) {
    const problem = mapRowToProblem(row);
    const category = problem.problemCategory || "uncategorized";
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(problem);
  }
  return grouped;
}

// Get top problem clusters for daily summary
export async function getTopProblemClusters(
  since: string,
): Promise<TopProblemCluster[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `
            SELECT
                problem_category,
                COUNT(*) as count,
                AVG(development_score) as avg_dev_score,
                GROUP_CONCAT(DISTINCT industry) as industries,
                MAX(pain_quote) as best_quote
            FROM problems
            WHERE created_at >= ? AND problem_category IS NOT NULL
            GROUP BY problem_category
            ORDER BY avg_dev_score DESC, count DESC
            LIMIT 10
        `,
    args: [since],
  });

  return result.rows.map((row) => ({
    category: row.problem_category as string,
    count: row.count as number,
    avgDevScore: Math.round((row.avg_dev_score as number) * 10) / 10,
    topIndustries: (row.industries as string)?.split(",").slice(0, 3) || [],
    bestQuote: row.best_quote as string | null,
  }));
}

// Save daily summary
export async function saveDailySummary(
  date: string,
  totalScanned: number,
  problemsFound: number,
  topProblems: TopProblemCluster[],
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();

  await db.execute({
    sql: `
            INSERT OR REPLACE INTO daily_summaries (id, date, total_scanned, problems_found, top_problems)
            VALUES (?, ?, ?, ?, ?)
        `,
    args: [id, date, totalScanned, problemsFound, JSON.stringify(topProblems)],
  });

  return id;
}

// Get latest daily summary
export async function getLatestSummary(): Promise<DailySummary | null> {
  const db = getDb();
  const result = await db.execute(
    "SELECT * FROM daily_summaries ORDER BY date DESC LIMIT 1",
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    date: row.date as string,
    totalScanned: row.total_scanned as number,
    problemsFound: row.problems_found as number,
    topProblems: JSON.parse(row.top_problems as string),
    createdAt: row.created_at as string,
  };
}

// Get count of problems found today
export async function getTodayStats(): Promise<{
  scanned: number;
  found: number;
}> {
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];

  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM problems WHERE DATE(created_at) = ?`,
    args: [today],
  });

  return {
    scanned: 0, // Will be tracked in memory during run
    found: result.rows[0].count as number,
  };
}

// ============ PHASE 2: Daily Intelligence Functions ============

// Save daily intelligence (AI-generated insights)
export async function saveDailyIntelligence(
  date: string,
  intelligence: {
    buildSuggestion: any;
    quickWins: any[];
    marketOpportunities: any[];
    insights: string[];
  },
): Promise<void> {
  const db = getDb();

  await db.execute({
    sql: `
      UPDATE daily_summaries
      SET
        build_suggestion = ?,
        quick_wins = ?,
        market_opportunities = ?,
        insights = ?,
        generated_at = CURRENT_TIMESTAMP
      WHERE date = ?
    `,
    args: [
      JSON.stringify(intelligence.buildSuggestion),
      JSON.stringify(intelligence.quickWins),
      JSON.stringify(intelligence.marketOpportunities),
      JSON.stringify(intelligence.insights),
      date,
    ],
  });
}

// Get daily intelligence for a specific date
export async function getDailyIntelligence(date: string): Promise<{
  buildSuggestion: any;
  quickWins: any[];
  marketOpportunities: any[];
  insights: string[];
  generatedAt: string;
} | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT
        build_suggestion,
        quick_wins,
        market_opportunities,
        insights,
        generated_at
      FROM daily_summaries
      WHERE date = ?
        AND build_suggestion IS NOT NULL
    `,
    args: [date],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    buildSuggestion: row.build_suggestion
      ? JSON.parse(row.build_suggestion as string)
      : null,
    quickWins: row.quick_wins ? JSON.parse(row.quick_wins as string) : [],
    marketOpportunities: row.market_opportunities
      ? JSON.parse(row.market_opportunities as string)
      : [],
    insights: row.insights ? JSON.parse(row.insights as string) : [],
    generatedAt: row.generated_at as string,
  };
}

// Get latest daily intelligence
export async function getLatestDailyIntelligence(): Promise<{
  date: string;
  buildSuggestion: any;
  quickWins: any[];
  marketOpportunities: any[];
  insights: string[];
  generatedAt: string;
} | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT
        date,
        build_suggestion,
        quick_wins,
        market_opportunities,
        insights,
        generated_at
      FROM daily_summaries
      WHERE build_suggestion IS NOT NULL
      ORDER BY date DESC
      LIMIT 1
    `,
    args: [],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    date: row.date as string,
    buildSuggestion: row.build_suggestion
      ? JSON.parse(row.build_suggestion as string)
      : null,
    quickWins: row.quick_wins ? JSON.parse(row.quick_wins as string) : [],
    marketOpportunities: row.market_opportunities
      ? JSON.parse(row.market_opportunities as string)
      : [],
    insights: row.insights ? JSON.parse(row.insights as string) : [],
    generatedAt: row.generated_at as string,
  };
}

// Get problems for AI analysis (with full content)
export async function getProblemsForAnalysis(
  limit: number = 50,
  minDevScore: number = 7,
): Promise<Problem[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT * FROM problems
      WHERE development_score >= ?
        AND bait_score < 50
        AND status != 'archived'
      ORDER BY development_score DESC, created_at DESC
      LIMIT ?
    `,
    args: [minDevScore, limit],
  });

  return result.rows.map(mapRowToProblem);
}

// Get problems by cluster for analysis
export async function getProblemsByCluster(
  clusterId: string,
): Promise<Problem[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT * FROM problems
      WHERE cluster_id = ?
      ORDER BY development_score DESC
      LIMIT 20
    `,
    args: [clusterId],
  });

  return result.rows.map(mapRowToProblem);
}

// Get all clusters for intelligence generation
export async function getAllClustersForIntelligence(): Promise<any[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT
        pc.*,
        COUNT(p.id) as actual_post_count,
        AVG(p.development_score) as actual_avg_score
      FROM problem_clusters pc
      LEFT JOIN problems p ON p.cluster_id = pc.id
      GROUP BY pc.id
      ORDER BY actual_post_count DESC
    `,
    args: [],
  });

  return result.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    keywords: row.keywords ? JSON.parse(row.keywords) : [],
    postCount: row.actual_post_count || 0,
    avgDevScore: row.actual_avg_score || 0,
    validationLevel: row.validation_level,
    aiSynthesis: row.ai_synthesis,
    industries: row.industries ? JSON.parse(row.industries) : [],
    bestQuotes: row.best_quotes ? JSON.parse(row.best_quotes) : [],
  }));
}

// Helper to map database row to Problem type
function mapRowToProblem(row: any): Problem {
  return {
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
    status: (row.status || "new") as ProblemStatus,
    starred: Boolean(row.starred),
    notes: row.notes as string | null,
    clusterId: row.cluster_id as string | null,
    postedAt: row.posted_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    baitScore: (row.bait_score as number) || 0,
    baitMethod: row.bait_method as string | null,
    baitFiltered: Boolean(row.bait_filtered),
  };
}
