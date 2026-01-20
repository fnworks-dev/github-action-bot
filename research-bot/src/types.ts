// Problem from any source
export interface Problem {
  id: string;
  source: "reddit" | "hackernews";
  sourceId: string;
  sourceUrl: string;
  title: string;
  content: string | null;
  author: string | null;
  subreddit: string | null;

  // AI analysis
  relevance: number | null; // 1-10 is this a real business pain?
  severity: number | null; // 1-10 how painful
  developmentScore: number | null; // 1-10 worth building a solution?
  problemCategory: string | null; // e.g., "invoicing", "scheduling"
  industry: string | null; // e.g., "restaurant", "law firm"
  summary: string | null; // concise problem description
  painQuote: string | null; // best quote from the post
  competitors: string | null; // existing solutions mentioned

  // Tracking
  status: ProblemStatus;
  starred: boolean;
  notes: string | null;
  clusterId: string | null; // associated cluster

  // Timestamps
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;

  // Bait detection (Phase 1)
  baitScore: number; // 0-100, higher = more likely promotional
  baitMethod: string | null; // 'pattern', 'subreddit', 'combined'
  baitFiltered: boolean; // true if flagged as bait
}

export type ProblemStatus =
  | "new"
  | "interesting"
  | "researching"
  | "validated"
  | "archived";

// Raw post from RSS/API
export interface RawPost {
  source: "reddit" | "hackernews";
  sourceId: string;
  sourceUrl: string;
  title: string;
  content: string | null;
  author: string | null;
  subreddit: string | null;  // Always present, but can be null (e.g., for HN posts)
  postedAt: string | null;
}

// AI analysis result (single post)
export interface AnalysisResult {
  relevance: number;
  severity: number;
  developmentScore: number;
  problemCategory: string;
  industry: string;
  summary: string;
  painQuote: string;
  competitors: string;
}

// Batch analysis result
export interface BatchAnalysisResult {
  sourceId: string;
  analysis: AnalysisResult | null; // null if not relevant
}

// Daily summary for Discord
export interface DailySummary {
  id: string;
  date: string;
  totalScanned: number;
  problemsFound: number;
  topProblems: TopProblemCluster[];
  createdAt: string;
}

export interface TopProblemCluster {
  category: string;
  count: number;
  avgDevScore: number;
  topIndustries: string[];
  bestQuote: string | null;
}

// Problem cluster (grouped by fuzzy matching)
export interface ProblemCluster {
  id: string;
  name: string; // "Financial Automation"
  keywords: string[]; // ["invoicing", "billing"]
  postCount: number;
  avgDevScore: number;
  validationLevel: "HIGH" | "MEDIUM" | "LOW";
  aiSynthesis: string | null; // AI-generated insight
  industries: string[]; // affected industries
  bestQuotes: string[]; // best pain quotes
  createdAt: string;
  updatedAt: string;
}

// Weekly executive summary
export interface WeeklySummary {
  id: string;
  weekStart: string;
  weekEnd: string;
  topOpportunities: Array<{
    category: string;
    totalMentions: number;
    avgDevScore: number;
    whyWorthBuilding: string;
    suggestedApproach: string;
  }>;
  emergingTrends: string[]; // trending categories
  quickWins: string[]; // high score, easy to solve
  weeklyInsight: string; // 2-3 sentence takeaway
  createdAt: string;
}

// Discord notification payload
export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  url?: string;
  timestamp?: string;
}

// Daily Intelligence (Phase 2)
export interface BuildSuggestion {
  title: string; // "Build an AI-Powered Invoicing Assistant"
  why: string; // "Multiple users mention spending 2+ hours daily..."
  targetUsers: string[]; // ["freelancers", "small agencies"]
  keyFeatures: string[]; // ["auto-extract from emails", "smart reminders"]
  mvpScope: string; // "Weekend project: Simple email parser + Notion integration"
  sourceClusterId: string;
  sourcePosts: string[]; // URLs
  estimatedBuildTime: "weekend" | "1-week" | "2-weeks" | "1-month";
}

export interface QuickWin {
  postId: string;
  title: string;
  idea: string; // "Build a simple X that does Y"
  whyQuick: string; // "Single feature, clear demand"
  complexity: "weekend" | "1-week" | "2-weeks";
  demand: "high" | "medium" | "low";
  sourceUrl: string;
  sourceContent: string; // Original post content for context
}

export interface DailyIntelligence {
  date: string;
  buildSuggestion: BuildSuggestion | null;
  quickWins: QuickWin[];
  marketOpportunities: any[]; // Keep existing clusters format
  insights: string[];
  generatedAt: string;
}
