import { getDb } from "./turso.js";
import type { Problem, ProblemCluster, ProblemStatus } from "../types.js";

// Category similarity mappings (fuzzy matching)
const CATEGORY_GROUPS: Record<string, string[]> = {
  "Financial Automation": [
    "invoicing",
    "billing",
    "invoices",
    "payment tracking",
    "expense management",
    "financial reporting",
    "accounting",
  ],
  "Employee Management": [
    "scheduling",
    "rostering",
    "shift planning",
    "time tracking",
    "attendance",
    "payroll",
    "hr",
  ],
  "Lead Management": [
    "lead tracking",
    "crm",
    "data entry",
    "contact management",
    "pipeline",
    "follow-ups",
  ],
  Communication: [
    "email templates",
    "notifications",
    "customer support",
    "messaging",
    "chat",
  ],
  "Inventory & Supply": [
    "inventory",
    "stock management",
    "supply chain",
    "logistics",
    "fulfillment",
    "orders",
  ],
  Marketing: [
    "social media",
    "content creation",
    "advertising",
    "seo",
    "analytics",
    "campaigns",
  ],
  "Compliance & Legal": [
    "compliance",
    "legal documentation",
    "contracts",
    "regulations",
    "certifications",
  ],
  "Project Management": [
    "task management",
    "project tracking",
    "deadlines",
    "collaboration",
    "workflow",
  ],
  "Data & Reporting": [
    "reporting",
    "data visualization",
    "dashboards",
    "analytics",
    "business intelligence",
  ],
  "E-commerce": [
    "product listings",
    "cart abandonment",
    "checkout",
    "product catalog",
    "pricing",
  ],
  Productivity: [
    "automation",
    "productivity tools",
    "efficiency",
    "workflow optimization",
  ],
  "Customer Experience": [
    "customer feedback",
    "reviews",
    "support",
    "onboarding",
    "retention",
  ],
};

// Find cluster name for a category using fuzzy matching
function findClusterName(category: string): string {
  const normalized = category.toLowerCase().trim();

  for (const [clusterName, keywords] of Object.entries(CATEGORY_GROUPS)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword) || keyword.includes(normalized)) {
        return clusterName;
      }
    }
  }

  // Capitalize first letter as default cluster name
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// Get all unique categories from problems
async function getAllCategories(): Promise<string[]> {
  const db = getDb();
  const result = await db.execute(`
        SELECT DISTINCT problem_category
        FROM problems
        WHERE problem_category IS NOT NULL
        ORDER BY problem_category
    `);
  return result.rows.map((row) => row.problem_category as string);
}

// Group categories into clusters
function groupCategoriesIntoClusters(
  categories: string[],
): Map<string, string[]> {
  const clusters = new Map<string, Set<string>>();

  for (const category of categories) {
    const clusterName = findClusterName(category);
    if (!clusters.has(clusterName)) {
      clusters.set(clusterName, new Set());
    }
    clusters.get(clusterName)!.add(category);
  }

  // Convert Sets to Arrays
  const result = new Map<string, string[]>();
  for (const [clusterName, categorySet] of clusters) {
    result.set(clusterName, Array.from(categorySet));
  }

  return result;
}

// Create or update a cluster
async function upsertCluster(
  clusterName: string,
  categories: string[],
  problems: Problem[],
): Promise<string> {
  const db = getDb();
  const clusterId = `cluster_${clusterName.toLowerCase().replace(/\s+/g, "_")}`;

  // Calculate cluster stats
  const avgDevScore =
    problems.reduce((sum, p) => sum + (p.developmentScore || 0), 0) /
    problems.length;
  const industries = [
    ...new Set(problems.map((p) => p.industry).filter(Boolean)),
  ];
  const bestQuotes = problems
    .map((p) => p.painQuote)
    .filter(Boolean)
    .slice(0, 5);

  // Limit payload sizes to prevent Turso database errors (max 1.5MB per query)
  const limitedCategories = categories.slice(0, 50);  // Max 50 categories
  const limitedIndustries = industries.slice(0, 20);  // Max 20 industries
  const limitedBestQuotes = bestQuotes
    .slice(0, 5)  // Max 5 quotes
    .map(quote => quote ? quote.substring(0, 200) : "");  // Max 200 chars per quote

  // Validation level
  let validationLevel: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (problems.length >= 5) validationLevel = "HIGH";
  else if (problems.length >= 3) validationLevel = "MEDIUM";

  // Check if cluster exists
  const existing = await db.execute({
    sql: "SELECT id FROM problem_clusters WHERE id = ?",
    args: [clusterId],
  });

  if (existing.rows.length > 0) {
    // Update existing cluster
    await db.execute({
      sql: `
                UPDATE problem_clusters
                SET post_count = ?, avg_dev_score = ?, validation_level = ?,
                    industries = ?, best_quotes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
      args: [
        problems.length,
        avgDevScore,
        validationLevel,
        JSON.stringify(limitedIndustries),
        JSON.stringify(limitedBestQuotes),
        clusterId,
      ],
    });
  } else {
    // Create new cluster
    await db.execute({
      sql: `
                INSERT INTO problem_clusters (id, name, keywords, post_count, avg_dev_score, validation_level, industries, best_quotes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
      args: [
        clusterId,
        clusterName,
        JSON.stringify(limitedCategories),
        problems.length,
        avgDevScore,
        validationLevel,
        JSON.stringify(limitedIndustries),
        JSON.stringify(limitedBestQuotes),
      ],
    });
  }

  return clusterId;
}

// Assign cluster_id to all problems in a cluster
async function assignClusterToProblems(
  clusterId: string,
  categories: string[],
): Promise<void> {
  const db = getDb();

  const chunkSize = 50;
  for (let i = 0; i < categories.length; i += chunkSize) {
    const chunk = categories.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db.execute({
      sql: `UPDATE problems SET cluster_id = ? WHERE problem_category IN (${placeholders})`,
      args: [clusterId, ...chunk],
    });
  }
}

// Auto-assign status based on cluster size
async function autoAssignStatuses(): Promise<void> {
  const db = getDb();

  // Get all clusters with their problem counts
  const clusters = await db.execute({
    sql: "SELECT id, post_count FROM problem_clusters",
    args: [],
  });

  for (const cluster of clusters.rows) {
    const clusterId = cluster.id as string;
    const postCount = cluster.post_count as number;

    let newStatus: string;
    if (postCount >= 5) {
      newStatus = "validated";
    } else if (postCount >= 3) {
      newStatus = "researching";
    } else if (postCount >= 2) {
      newStatus = "interesting";
    } else {
      continue; // Don't update if count is 1
    }

    // Update all problems in this cluster
    await db.execute({
      sql: `UPDATE problems SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE cluster_id = ?`,
      args: [newStatus, clusterId],
    });
  }

  console.log(`✅ Auto-assigned statuses to ${clusters.rows.length} clusters`);
}

// Main function: generate clusters from all problems
export async function generateClusters(): Promise<void> {
  console.log("🔄 Generating problem clusters...");

  // 1. Get all categories
  const categories = await getAllCategories();
  console.log(`   Found ${categories.length} unique categories`);

  // 2. Group categories into fuzzy clusters
  const categoryGroups = groupCategoriesIntoClusters(categories);
  console.log(`   Grouped into ${categoryGroups.size} clusters`);

  // 3. For each cluster, get all problems and upsert
  for (const [clusterName, clusterCategories] of categoryGroups) {
    const db = getDb();

    // Get all problems for these categories
    const categoryList = clusterCategories.map((c) => `'${c}'`).join(",");
    const result = await db.execute(`
            SELECT * FROM problems WHERE problem_category IN (${categoryList})
        `);

    const problems = result.rows.map(mapRowToProblem);

    if (problems.length > 0) {
      // Create/update cluster
      const clusterId = await upsertCluster(
        clusterName,
        clusterCategories,
        problems,
      );

      // Assign cluster_id to problems
      await assignClusterToProblems(clusterId, clusterCategories);

      console.log(
        `   📦 ${clusterName}: ${problems.length} posts (validation: ${problems.length >= 5 ? "HIGH" : problems.length >= 3 ? "MEDIUM" : "LOW"})`,
      );
    }
  }

  // 4. Auto-assign statuses based on cluster size
  await autoAssignStatuses();

  console.log("✅ Cluster generation complete");
}

// Get cluster by ID
export async function getClusterById(
  clusterId: string,
): Promise<ProblemCluster | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM problem_clusters WHERE id = ?",
    args: [clusterId],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
    keywords: JSON.parse((row.keywords as string) || "[]"),
    postCount: row.post_count as number,
    avgDevScore: Math.round((row.avg_dev_score as number) * 10) / 10,
    validationLevel: row.validation_level as "HIGH" | "MEDIUM" | "LOW",
    aiSynthesis: row.ai_synthesis as string | null,
    industries: JSON.parse((row.industries as string) || "[]"),
    bestQuotes: JSON.parse((row.best_quotes as string) || "[]"),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// Get all problems in a cluster
export async function getProblemsByCluster(
  clusterId: string,
): Promise<Problem[]> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM problems WHERE cluster_id = ? ORDER BY development_score DESC",
    args: [clusterId],
  });

  return result.rows.map(mapRowToProblem);
}

// Get all clusters
export async function getAllClusters(): Promise<ProblemCluster[]> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM problem_clusters ORDER BY post_count DESC, avg_dev_score DESC",
    args: [],
  });

  return result.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    keywords: JSON.parse((row.keywords as string) || "[]"),
    postCount: row.post_count as number,
    avgDevScore: Math.round((row.avg_dev_score as number) * 10) / 10,
    validationLevel: row.validation_level as "HIGH" | "MEDIUM" | "LOW",
    aiSynthesis: row.ai_synthesis as string | null,
    industries: JSON.parse((row.industries as string) || "[]"),
    bestQuotes: JSON.parse((row.best_quotes as string) || "[]"),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

// Update cluster AI synthesis
export async function updateClusterSynthesis(
  clusterId: string,
  synthesis: string,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "UPDATE problem_clusters SET ai_synthesis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [synthesis, clusterId],
  });
}

// Get clusters that need AI synthesis (those without it or recently updated)
export async function getClustersNeedingSynthesis(): Promise<ProblemCluster[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `
            SELECT * FROM problem_clusters
            WHERE ai_synthesis IS NULL
               OR updated_at < datetime('now', '-7 days')
            ORDER BY post_count DESC, avg_dev_score DESC
        `,
    args: [],
  });

  return result.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    keywords: JSON.parse((row.keywords as string) || "[]"),
    postCount: row.post_count as number,
    avgDevScore: Math.round((row.avg_dev_score as number) * 10) / 10,
    validationLevel: row.validation_level as "HIGH" | "MEDIUM" | "LOW",
    aiSynthesis: row.ai_synthesis as string | null,
    industries: JSON.parse((row.industries as string) || "[]"),
    bestQuotes: JSON.parse((row.best_quotes as string) || "[]"),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

// Helper to map row (needed here since it's not exported from turso.ts)
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
    status: row.status as ProblemStatus,
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
