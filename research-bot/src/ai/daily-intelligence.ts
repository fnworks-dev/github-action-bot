import { callWithRetry } from "./analyzer.js";
import type {
  Problem,
  ProblemCluster,
  BuildSuggestion,
  QuickWin,
} from "../types.js";

const BUILD_SUGGESTION_PROMPT = `You are a product analyst. Based on these problem posts and the cluster analysis, suggest a SPECIFIC MVP to build.

Analyze the cluster and posts, then suggest ONE concrete MVP idea:
- Should be buildable in 1-2 weeks (weekend warrior to 1-week max)
- Must solve a real pain point mentioned in the posts
- Should have clear demand (multiple posts mentioning similar issues)

Return JSON with:
{
  "title": "Build an X that does Y",
  "why": "Why this is compelling (2-3 sentences, reference actual quotes from posts)",
  "targetUsers": ["user type 1", "user type 2"],
  "keyFeatures": ["feature 1", "feature 2", "feature 3"],
  "mvpScope": "Specific scope: e.g., 'Weekend project: Email parser that extracts X and sends to Y'",
  "estimatedBuildTime": "weekend" | "1-week" | "2-weeks",
  "sourcePosts": ["url1", "url2"] // URLs that support this idea
}

CLUSTER: {clusterName}
Cluster Summary: {clusterSynthesis}
Industries: {industries}

POSTS IN THIS CLUSTER:
{posts}

Return ONLY valid JSON. No markdown.`;

const QUICK_WINS_PROMPT = `You are a product scout. Find QUICK WINS - simple, buildable products from these posts.

A QUICK WIN is:
- Simple scope (1 feature or focused tool)
- Clear pain point
- Buildable in weekend to 1 week
- Real demand (not just "interesting")

Look for posts mentioning:
- "I wish there was a tool that..."
- "I need something that..."
- Specific problems with simple solutions
- Manual tasks that could be automated

Return JSON array of 3-5 best quick wins:
[
  {
    "postId": "id",
    "title": "post title",
    "idea": "Build a simple X that does Y",
    "whyQuick": "Why this is a quick win (1 sentence)",
    "complexity": "weekend" | "1-week",
    "demand": "high" | "medium" | "low",
    "sourceUrl": "url",
    "sourceContent": "original post content snippet (max 100 chars)"
  }
]

If there aren't 3-5 quality quick wins, return fewer. Don't force it - quality over quantity.

POSTS:
{posts}

Return ONLY valid JSON array. No markdown.`;

const INSIGHTS_PROMPT = `You are a market analyst. What are the key insights from today's problem research?

Analyze these clusters and identify:
1. Emerging trends (what problems are gaining attention?)
2. Pain patterns (what issues keep coming up?)
3. Market gaps (where are people underserved?)

Return JSON array of 3-5 insights:
[
  "Insight 1: Trend X is emerging...",
  "Insight 2: Users repeatedly struggle with Y...",
  "Insight 3: Gap in Z market..."
]

Each insight should be 1 sentence, specific, and actionable.

CLUSTERS:
{clusters}

Return ONLY valid JSON array. No markdown.`;

interface BuildSuggestionResponse {
  title: string;
  why: string;
  targetUsers: string[];
  keyFeatures: string[];
  mvpScope: string;
  estimatedBuildTime: "weekend" | "1-week" | "2-weeks";
  sourcePosts: string[];
}

interface QuickWinsResponse {
  postId: string;
  title: string;
  idea: string;
  whyQuick: string;
  complexity: "weekend" | "1-week";
  demand: "high" | "medium" | "low";
  sourceUrl: string;
  sourceContent: string;
}

/**
 * Generate build suggestion from top cluster
 */
export async function generateBuildSuggestion(
  cluster: ProblemCluster,
  problems: Problem[],
): Promise<BuildSuggestion | null> {
  if (problems.length === 0) return null;

  const postsText = problems
    .slice(0, 10)
    .map(
      (p) => `
Title: ${p.title}
URL: ${p.sourceUrl}
Summary: ${p.summary || "N/A"}
Pain Quote: ${p.painQuote || "N/A"}
Score: ${p.developmentScore || "N/A"}
---`,
    )
    .join("\n");

  const prompt = BUILD_SUGGESTION_PROMPT.replace("{clusterName}", cluster.name)
    .replace(
      "{clusterSynthesis}",
      cluster.aiSynthesis || "No synthesis available",
    )
    .replace("{industries}", cluster.industries.join(", "))
    .replace("{posts}", postsText);

  try {
    const content = await callWithRetry(async () => {
      const response = await fetch(
        "https://api.z.ai/api/anthropic/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 800,
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const textBlock = data.content?.find(
        (block: any) => block.type === "text",
      );
      return textBlock?.text || "";
    }, "Build Suggestion Generation");

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in build suggestion response");
      return null;
    }

    const suggestion: BuildSuggestionResponse = JSON.parse(jsonMatch[0]);

    return {
      ...suggestion,
      sourceClusterId: cluster.id,
    };
  } catch (error: any) {
    console.error("Failed to generate build suggestion:", error.message);
    return null;
  }
}

/**
 * Generate quality quick wins from problems
 */
export async function generateQuickWins(
  problems: Problem[],
): Promise<QuickWin[]> {
  if (problems.length === 0) return [];

  // Filter for high-quality candidates
  const candidates = problems
    .filter((p) => (p.developmentScore || 0) >= 7 && p.baitScore < 50)
    .slice(0, 30);

  if (candidates.length === 0) return [];

  const postsText = candidates
    .map(
      (p) => `
ID: ${p.id}
Title: ${p.title}
URL: ${p.sourceUrl}
Summary: ${p.summary || "N/A"}
Content: ${(p.content || "").slice(0, 200)}
Dev Score: ${p.developmentScore || "N/A"}
---`,
    )
    .join("\n");

  const prompt = QUICK_WINS_PROMPT.replace("{posts}", postsText);

  try {
    const content = await callWithRetry(async () => {
      const response = await fetch(
        "https://api.z.ai/api/anthropic/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1200,
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const textBlock = data.content?.find(
        (block: any) => block.type === "text",
      );
      return textBlock?.text || "";
    }, "Quick Wins Generation");

    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("No JSON array found in quick wins response");
      return [];
    }

    const quickWins: QuickWin[] = JSON.parse(jsonMatch[0]);
    return quickWins;
  } catch (error: any) {
    console.error("Failed to generate quick wins:", error.message);
    return [];
  }
}

/**
 * Generate market insights from clusters
 */
export async function generateMarketInsights(
  clusters: ProblemCluster[],
): Promise<string[]> {
  if (clusters.length === 0) return [];

  const clustersText = clusters
    .slice(0, 15)
    .map(
      (c) => `
Cluster: ${c.name}
Posts: ${c.postCount}
Avg Score: ${c.avgDevScore}
Industries: ${c.industries.join(", ")}
Synthesis: ${c.aiSynthesis || "N/A"}
---`,
    )
    .join("\n");

  const prompt = INSIGHTS_PROMPT.replace("{clusters}", clustersText);

  try {
    const content = await callWithRetry(async () => {
      const response = await fetch(
        "https://api.z.ai/api/anthropic/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 500,
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const textBlock = data.content?.find(
        (block: any) => block.type === "text",
      );
      return textBlock?.text || "";
    }, "Market Insights Generation");

    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("No JSON array found in insights response");
      return [];
    }

    const insights: string[] = JSON.parse(jsonMatch[0]);
    return insights;
  } catch (error: any) {
    console.error("Failed to generate market insights:", error.message);
    return [];
  }
}

/**
 * Generate complete daily intelligence
 */
export async function generateDailyIntelligence(
  clusters: ProblemCluster[],
  allProblems: Problem[],
): Promise<{
  buildSuggestion: BuildSuggestion | null;
  quickWins: QuickWin[];
  insights: string[];
}> {
  console.log("🤖 Generating daily intelligence...");

  // 1. Generate build suggestion from top cluster
  let buildSuggestion: BuildSuggestion | null = null;
  if (clusters.length > 0) {
    const topCluster = clusters[0];
    const clusterProblems = allProblems.filter(
      (p) => p.clusterId === topCluster.id,
    );

    if (clusterProblems.length > 0) {
      console.log(
        `   💡 Generating build suggestion from "${topCluster.name}"...`,
      );
      buildSuggestion = await generateBuildSuggestion(
        topCluster,
        clusterProblems,
      );
      if (buildSuggestion) {
        console.log(
          `   ✅ Build suggestion: ${buildSuggestion.title.slice(0, 60)}...`,
        );
      }
    }
  }

  // 2. Generate quality quick wins
  console.log("   ⚡ Generating quality quick wins...");
  const quickWins = await generateQuickWins(allProblems);
  console.log(`   ✅ Found ${quickWins.length} quality quick wins`);

  // 3. Generate market insights
  console.log("   🔍 Generating market insights...");
  const insights = await generateMarketInsights(clusters);
  console.log(`   ✅ Generated ${insights.length} market insights`);

  return {
    buildSuggestion,
    quickWins,
    insights,
  };
}
