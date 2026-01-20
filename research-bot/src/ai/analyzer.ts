import { config } from "../config.js";
import type { RawPost, AnalysisResult, BatchAnalysisResult } from "../types.js";

const BATCH_ANALYSIS_PROMPT = `You are a problem research analyst. Analyze these posts to find REAL BUSINESS PAIN POINTS that could be solved with software.

For EACH post, determine if it describes a genuine business problem. Return a JSON array.

For each post:
- If it's NOT a real problem (just discussion, news, self-promo): return null
- If it IS a real problem: return the analysis object

Analysis fields:
- "relevance": 1-10 (is this a real business pain? 1=not a problem, 10=critical pain)
- "severity": 1-10 (how painful? 1=minor, 10=major)
- "developmentScore": 1-10 (worth building a solution?)
  - Consider: frequency, market size, existing solutions quality, technical feasibility
  - 8-10: High value opportunity, should build
  - 5-7: Maybe worth exploring
  - 1-4: Not worth developing
- "problemCategory": short category (e.g., "invoicing", "scheduling", "inventory", "reporting")
- "industry": which industry (e.g., "restaurant", "law firm", "e-commerce", "general")
- "summary": 1-2 sentence problem description
- "painQuote": extract the BEST quote that shows pain (for landing page copy), or empty string
- "competitors": existing solutions mentioned (or "none mentioned")

POSTS TO ANALYZE:
{posts}

Return ONLY valid JSON array like:
[
  {"sourceId": "abc123", "analysis": {"relevance": 8, "severity": 7, ...}},
  {"sourceId": "def456", "analysis": null},
  ...
]`;

// Anthropic-compatible response format (Z.ai proxy)
interface GLMResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  error?: { message: string };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  error?: { message: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Format posts for batch analysis
function formatPostsForPrompt(posts: RawPost[]): string {
  return posts
    .map(
      (p, i) =>
        `[${i + 1}] ID: ${p.sourceId}
Source: ${p.subreddit || p.source}
Title: ${p.title}
Content: ${(p.content || "").slice(0, 500)}
---`,
    )
    .join("\n");
}

// Retry wrapper
export async function callWithRetry(
  fn: () => Promise<string>,
  name: string,
  maxRetries = 2,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(
          `   ⏳ Retry ${attempt}/${maxRetries}, waiting ${delay / 1000}s...`,
        );
        await sleep(delay);
      }
      return await fn();
    } catch (error: any) {
      const isRateLimit = error.message?.includes("429");
      if (isRateLimit && attempt < maxRetries) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`${name} failed after ${maxRetries} attempts`);
}

// Analyze with GLM via Z.ai (Anthropic-compatible)
async function analyzeWithGLM(prompt: string): Promise<string> {
  const response = await fetch(config.ai.glmUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.ai.glmKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", // Maps to GLM via Z.ai proxy
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.log(`   GLM error ${response.status}: ${errorText.slice(0, 100)}`);
    throw new Error(`GLM API error: ${response.status}`);
  }

  const data: GLMResponse = await response.json();

  if (data.error) {
    throw new Error(`GLM error: ${data.error.message}`);
  }

  // Anthropic format: content is array of blocks with type and text
  const textBlock = data.content?.find((block) => block.type === "text");
  return textBlock?.text || "";
}

// Analyze with Gemini (fallback)
async function analyzeWithGemini(prompt: string): Promise<string> {
  const url = `${config.ai.geminiUrl}?key=${config.ai.geminiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2000,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.log(
      `   Gemini error ${response.status}: ${errorText.slice(0, 100)}`,
    );
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(`Gemini error: ${data.error.message}`);
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// Batch analyze posts
export async function analyzeBatch(
  posts: RawPost[],
): Promise<BatchAnalysisResult[]> {
  if (posts.length === 0) return [];

  const prompt = BATCH_ANALYSIS_PROMPT.replace(
    "{posts}",
    formatPostsForPrompt(posts),
  );

  try {
    let content: string = "";

    // Try GLM first
    if (config.ai.glmKey) {
      try {
        content = await callWithRetry(() => analyzeWithGLM(prompt), "GLM", 2);
      } catch (glmError: any) {
        console.log(`   ⚠️ GLM failed: ${glmError.message}`);
      }
    }

    // Fallback to Gemini
    if (!content && config.ai.geminiKey) {
      try {
        content = await callWithRetry(
          () => analyzeWithGemini(prompt),
          "Gemini",
          2,
        );
      } catch (geminiError: any) {
        console.log(`   ⚠️ Gemini failed: ${geminiError.message}`);
      }
    }

    if (!content) {
      console.log("   ⚠️ All AI providers failed, skipping batch");
      return posts.map((p) => ({ sourceId: p.sourceId, analysis: null }));
    }

    // Parse JSON response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("   ⚠️ No JSON array in response");
      return posts.map((p) => ({ sourceId: p.sourceId, analysis: null }));
    }

    const results: BatchAnalysisResult[] = JSON.parse(jsonMatch[0]);

    // Validate and normalize results
    return results.map((r) => ({
      sourceId: r.sourceId,
      analysis: r.analysis
        ? {
            relevance: Math.min(10, Math.max(1, r.analysis.relevance || 1)),
            severity: Math.min(10, Math.max(1, r.analysis.severity || 1)),
            developmentScore: Math.min(
              10,
              Math.max(1, r.analysis.developmentScore || 1),
            ),
            problemCategory: r.analysis.problemCategory || "uncategorized",
            industry: r.analysis.industry || "general",
            summary: r.analysis.summary || "",
            painQuote: r.analysis.painQuote || "",
            competitors: r.analysis.competitors || "none mentioned",
          }
        : null,
    }));
  } catch (error: any) {
    console.error("Batch analysis error:", error.message);
    return posts.map((p) => ({ sourceId: p.sourceId, analysis: null }));
  }
}

// Weekly summary prompt
const WEEKLY_SUMMARY_PROMPT = `Analyze these problem clusters from the past week and create an executive summary.

DATA:
{data}

Create a summary with:
1. "topOpportunities": Array of top 3 problems worth building solutions for
   - category (cluster name), totalMentions, avgDevScore, whyWorthBuilding, suggestedApproach
2. "emergingTrends": Problems that appeared multiple days or have growing post counts
3. "quickWins": High scoring problems (7+) that seem technically straightforward
4. "weeklyInsight": 2-3 sentence overall takeaway about the market opportunity

Return valid JSON only.`;

export async function generateWeeklySummary(weekData: string): Promise<any> {
  const prompt = WEEKLY_SUMMARY_PROMPT.replace("{data}", weekData);

  try {
    let content = "";

    if (config.ai.glmKey) {
      content = await callWithRetry(() => analyzeWithGLM(prompt), "GLM", 2);
    } else if (config.ai.geminiKey) {
      content = await callWithRetry(
        () => analyzeWithGemini(prompt),
        "Gemini",
        2,
      );
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Weekly summary generation failed:", error);
  }

  return null;
}

// Cluster synthesis prompt
const CLUSTER_SYNTHESIS_PROMPT = `You are a product analyst analyzing {postCount} posts about "{clusterName}".

POSTS:
{posts}

Synthesize a 2-3 sentence insight that explains:
1. The core problem (what pain are they experiencing?)
2. Why this is worth building a solution (market validation)
3. Affected industries

Return only the insight text, no JSON.`;

export async function generateClusterSynthesis(
  clusterName: string,
  posts: Array<{
    title: string;
    summary?: string | null;
    painQuote?: string | null;
    industry?: string | null;
  }>,
): Promise<string> {
  const postsText = posts
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title}\n   Summary: ${p.summary || "N/A"}\n   Pain: ${p.painQuote || "N/A"}\n   Industry: ${p.industry || "N/A"}`,
    )
    .join("\n\n");

  const prompt = CLUSTER_SYNTHESIS_PROMPT.replace("{clusterName}", clusterName)
    .replace("{postCount}", String(posts.length))
    .replace("{posts}", postsText.slice(0, 3000)); // Limit to avoid token limits

  try {
    let content = "";

    if (config.ai.glmKey) {
      content = await callWithRetry(() => analyzeWithGLM(prompt), "GLM", 2);
    } else if (config.ai.geminiKey) {
      content = await callWithRetry(
        () => analyzeWithGemini(prompt),
        "Gemini",
        2,
      );
    }

    // Clean up the response
    return content
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/^```[\s\S]*?```$/gm, "");
  } catch (error) {
    console.error("Cluster synthesis failed:", error);
    return "";
  }
}

// === AI SUGGESTIONS ===

export interface ProblemSuggestion {
  marketSize: { score: number; estimate: string; reasoning: string };
  revenuePotential: { score: number; estimate: string; reasoning: string };
  technicalComplexity: {
    score: number;
    assessment: string;
    keyChallenges: string[];
  };
  acquisitionDifficulty: {
    score: number;
    assessment: string;
    channels: string[];
  };
  competitiveIntensity: {
    score: number;
    assessment: string;
    gapOpportunity: string;
  };
  overallROI: { score: number; verdict: string; summary: string };
}

export interface ClusterSuggestion {
  marketValidation: { score: number; evidence: string; frequency: string };
  marketSize: { score: number; estimate: string; industries: string[] };
  revenuePotential: { score: number; pricingRange: string; reasoning: string };
  timeToMarket: { score: number; estimate: string; mvpFeatures: string[] };
  competitiveLandscape: {
    score: number;
    existingSolutions: string;
    differentiation: string;
  };
  overallROI: { score: number; verdict: string; summary: string };
}

const PROBLEM_SUGGESTION_PROMPT = `You are a startup advisor analyzing a business problem for ROI potential.

PROBLEM DETAILS:
Title: {title}
Summary: {summary}
Pain Quote: "{painQuote}"
Industry: {industry}
Category: {category}
Current Scores: Relevance={relevance}/10, Severity={severity}/10, Dev Score={devScore}/10
Competitors: {competitors}

Analyze the business opportunity and return a JSON object with:
{
  "marketSize": {"score": 1-10, "estimate": "TAM description (e.g., '~50K US restaurants')", "reasoning": "brief explanation"},
  "revenuePotential": {"score": 1-10, "estimate": "What customers would pay (e.g., '$50-150/mo')", "reasoning": "pricing rationale"},
  "technicalComplexity": {"score": 1-10, "assessment": "Simple/Medium/Complex", "keyChallenges": ["array of 2-3 main technical hurdles"]},
  "acquisitionDifficulty": {"score": 1-10, "assessment": "Easy/Medium/Hard", "channels": ["Suggested marketing channels"]},
  "competitiveIntensity": {"score": 1-10, "assessment": "Low/Medium/High", "gapOpportunity": "What's missing from current solutions"},
  "overallROI": {"score": 1-10, "verdict": "BUILD/EXPLORE/PASS", "summary": "2-3 sentence recommendation"}
}

Scoring guidelines:
- Market size: 1=niche, 5=moderate, 10=massive
- Revenue potential: 1=low willingness to pay, 10=high urgency/price
- Technical complexity: 1=trivial, 5=moderate, 10=very complex
- Acquisition difficulty: 1=easy reach, 10=very hard to find customers
- Competitive intensity: 1=no competition, 10=saturated market
- Overall ROI: Weighted average considering all factors

Return ONLY valid JSON.`;

const CLUSTER_SUGGESTION_PROMPT = `You are a startup advisor analyzing a problem cluster for ROI potential.

CLUSTER DETAILS:
Name: {name}
Description: {synthesis}
Post Count: {postCount}
Avg Dev Score: {avgDevScore}
Validation Level: {validationLevel}
Industries: {industries}
Sample Pain Points: {quotes}

Analyze the business opportunity and return a JSON object with:
{
  "marketValidation": {"score": 1-10, "evidence": "Why this is a real problem", "frequency": "How often this occurs"},
  "marketSize": {"score": 1-10, "estimate": "TAM description", "industries": ["Affected industries"]},
  "revenuePotential": {"score": 1-10, "pricingRange": "Expected pricing", "reasoning": "Why customers would pay"},
  "timeToMarket": {"score": 1-10, "estimate": "e.g., '2-3 months'", "mvpFeatures": ["Core features for MVP"]},
  "competitiveLandscape": {"score": 1-10, "existingSolutions": "What exists today", "differentiation": "How to stand out"},
  "overallROI": {"score": 1-10, "verdict": "HIGH_PRIORITY/MEDIUM_PRIORITY/LOW_PRIORITY", "summary": "2-3 sentence recommendation"}
}

Return ONLY valid JSON.`;

export async function analyzeProblemSuggestion(input: {
  title: string;
  summary: string | null;
  painQuote: string | null;
  industry: string | null;
  category: string | null;
  relevance: number;
  severity: number;
  devScore: number;
  competitors: string | null;
}): Promise<ProblemSuggestion> {
  const prompt = PROBLEM_SUGGESTION_PROMPT.replace("{title}", input.title)
    .replace("{summary}", input.summary || "N/A")
    .replace("{painQuote}", input.painQuote || "N/A")
    .replace("{industry}", input.industry || "General")
    .replace("{category}", input.category || "General")
    .replace("{relevance}", String(input.relevance))
    .replace("{severity}", String(input.severity))
    .replace("{devScore}", String(input.devScore))
    .replace("{competitors}", input.competitors || "None mentioned");

  try {
    let content = "";

    if (config.ai.glmKey) {
      content = await callWithRetry(() => analyzeWithGLM(prompt), "GLM", 2);
    } else if (config.ai.geminiKey) {
      content = await callWithRetry(
        () => analyzeWithGemini(prompt),
        "Gemini",
        2,
      );
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Problem suggestion analysis failed:", error);
  }

  // Fallback response
  return {
    marketSize: { score: 5, estimate: "Unknown", reasoning: "Analysis failed" },
    revenuePotential: {
      score: 5,
      estimate: "Unknown",
      reasoning: "Analysis failed",
    },
    technicalComplexity: { score: 5, assessment: "Unknown", keyChallenges: [] },
    acquisitionDifficulty: { score: 5, assessment: "Unknown", channels: [] },
    competitiveIntensity: {
      score: 5,
      assessment: "Unknown",
      gapOpportunity: "",
    },
    overallROI: {
      score: 5,
      verdict: "EXPLORE",
      summary: "Analysis unavailable",
    },
  };
}

export async function analyzeClusterSuggestion(input: {
  name: string;
  synthesis: string | null;
  postCount: number;
  avgDevScore: number;
  validationLevel: string;
  industries: string[];
  quotes: string[];
}): Promise<ClusterSuggestion> {
  const quotes = input.quotes
    .slice(0, 3)
    .map((q) => `"${q}"`)
    .join(", ");
  const industries = input.industries.slice(0, 5).join(", ");

  const prompt = CLUSTER_SUGGESTION_PROMPT.replace("{name}", input.name)
    .replace("{synthesis}", input.synthesis || "No description")
    .replace("{postCount}", String(input.postCount))
    .replace("{avgDevScore}", String(input.avgDevScore))
    .replace("{validationLevel}", input.validationLevel)
    .replace("{industries}", industries)
    .replace("{quotes}", quotes);

  try {
    let content = "";

    if (config.ai.glmKey) {
      content = await callWithRetry(() => analyzeWithGLM(prompt), "GLM", 2);
    } else if (config.ai.geminiKey) {
      content = await callWithRetry(
        () => analyzeWithGemini(prompt),
        "Gemini",
        2,
      );
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Cluster suggestion analysis failed:", error);
  }

  // Fallback response
  return {
    marketValidation: {
      score: 5,
      evidence: "Analysis failed",
      frequency: "Unknown",
    },
    marketSize: { score: 5, estimate: "Unknown", industries: [] },
    revenuePotential: {
      score: 5,
      pricingRange: "Unknown",
      reasoning: "Analysis failed",
    },
    timeToMarket: { score: 5, estimate: "Unknown", mvpFeatures: [] },
    competitiveLandscape: {
      score: 5,
      existingSolutions: "Unknown",
      differentiation: "",
    },
    overallROI: {
      score: 5,
      verdict: "MEDIUM_PRIORITY",
      summary: "Analysis unavailable",
    },
  };
}
