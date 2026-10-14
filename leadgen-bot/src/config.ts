// Configuration loaded from environment variables
const csv = (raw: string) => [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
const GEMINI_KEYS = csv([
  process.env.GEMINI_API_KEYS,
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_BACKUP_KEY_1,
  process.env.GEMINI_BACKUP_KEY_2,
].filter(Boolean).join(","));
export const config = {
  // Turso Database
  turso: {
    url: process.env.TURSO_DATABASE_URL || "",
    authToken: process.env.TURSO_AUTH_TOKEN || "",
  },

  // AI: Gemini key pool x model chain (see src/ai/gemini.ts).
  ai: {
    // Comma-separated GEMINI_API_KEYS (one per Google project; free limits are per project)
    // plus legacy single-key vars. Rotated per call with key failover.
    geminiKeys: GEMINI_KEYS,
    geminiKey: GEMINI_KEYS[0] || "",
    geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    // All 500 RPD free per project (2026-10-14); gemini-2.0-flash is retired.
    geminiModels: csv(process.env.GEMINI_MODELS || "gemini-3.1-flash-lite,gemini-3.1-flash-lite-preview,gemini-3.5-flash-lite"),
  },


  // Discord
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
    twitterHealthWebhookUrl: process.env.TWITTER_HEALTH_WEBHOOK_URL || "",
  },

  // Scoring
  minScoreThreshold: parseInt(process.env.MIN_SCORE_THRESHOLD || "6", 10),

  // Twitter/X Configuration
  twitter: {
    // Source selection: 'api' (TwitterAPI.io) or 'diy' (local scraper)
    source: (process.env.TWITTER_SOURCE || "diy") as "api" | "diy",

    // TwitterAPI.io configuration (for 'api' source)
    api: {
      enabled: !!process.env.TWITTERAPI_KEY,
      apiKey: process.env.TWITTERAPI_KEY || "",
    },

    // DIY Scraper configuration (for 'diy' source)
    diy: {
      enabled:
        process.env.TWITTER_ENABLED?.toLowerCase() === "true" ||
        process.env.TWITTER_SOURCE === "diy",
      cookiesPath:
        process.env.TWITTER_COOKIES_PATH || "./cookies/twitter_session.json",
      searchHours: parseInt(process.env.TWITTER_SEARCH_HOURS || "24", 10),
      maxResults: parseInt(process.env.TWITTER_MAX_RESULTS || "20", 10),
    },
  },

  // Reddit subreddits to monitor (focused on hiring intent)
  subreddits: [
    // High intent - people looking for developers
    "startups",
    "cofounder",
    "forhire",
    "freelance_forhire",
    "Entrepreneur",
    "EntrepreneurRideAlong",
    "SaaS",
    "smallbusiness",
    "indiehackers",
    "startup",
    "hwstartups",
    "Startup_Ideas",

    // Non-technical founders (high quality leads)
    "nocode",
    "webdev",
  ],

  // Keywords - INTENT FOCUSED (someone actively looking/hiring)
  keywords: [
    // Direct hiring signals
    "looking for developer",
    "looking for a developer",
    "looking for dev",
    "looking for a dev",

    "need developer",
    "need a developer",
    "need dev",
    "need a dev",

    "hiring developer",
    "hiring a developer",

    "seeking developer",
    "seeking a developer",

    "developer needed",
    "dev needed",
    "developer wanted",

    // Cofounder signals
    "looking for cofounder",
    "looking for co-founder",
    "looking for a cofounder",
    "looking for technical cofounder",
    "seeking cofounder",
    "seeking co-founder",
    "seeking technical cofounder",
    "need cofounder",
    "need a cofounder",
    "need technical cofounder",
    "need a technical co-founder",
    "cofounder wanted",
    "co-founder wanted",
    "CTO cofounder",
    "tech cofounder",

    // Build requests
    "need someone to build",
    "looking for someone to build",
    "help me build my",
    "who can build",

    // Hiring tags
    "[Hiring]",
    "[HIRING]",

    // Freelance/Agency
    "looking for agency",
    "looking for freelancer",
    "need freelancer",
    "hire freelancer",
  ],

  // Posts containing these will be SKIPPED (not shown)
  negativeFilters: [
    // Self-promotion / For Hire posts
    "[For Hire]",
    "[FOR HIRE]",
    "I am a developer",
    "I'm a developer",
    "offering my services",
    "available for hire",
    "my portfolio",
    "hire me",

    // Listicle spam
    "Top 10",
    "Top 5",
    "Best of",
    "Niche ideas",
    "ideas for",

    // Show-off posts
    "just launched",
    "I built",
    "I created",
    "check out my",
    "feedback on my",
    "roast my",

    // Non-developer jobs - Video editing
    "clipping",
    "clipper",
    "video editor",

    // Non-developer jobs - Surveys and studies
    "survey",
    "study participant",

    // Non-developer jobs - Game testing
    "test games",
    "game tester",

    // Non-developer jobs - Simple microtasks
    "simple tasks",
    "microtasks",

    // Non-developer jobs - Sales
    "sales representative",
    "telemarketing",

    // Non-developer jobs - Watching content
    "watch basketball",
    "watch videos",

    // Non-developer jobs - Social media
    "reddit post",
    "reddit comment",
    "reddit account",
  ],
};

// Validate required config
export function validateConfig(): void {
  const required = [
    ["TURSO_DATABASE_URL", config.turso.url],
    ["TURSO_AUTH_TOKEN", config.turso.authToken],
    ["DISCORD_WEBHOOK_URL", config.discord.webhookUrl],
  ];

  const missing = required.filter(([_, value]) => !value);

  if (!config.ai.geminiKeys.length) {
    missing.push(["GEMINI_API_KEYS", ""]);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map(([name]) => name).join(", ")}`,
    );
  }
}

// Check if post should be filtered out
export function shouldFilterPost(title: string, content: string): boolean {
  const text = `${title} ${content || ""}`.toLowerCase();

  return config.negativeFilters.some((filter) =>
    text.includes(filter.toLowerCase()),
  );
}
