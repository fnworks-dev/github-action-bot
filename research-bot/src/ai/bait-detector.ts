/**
 * Bait Post Detector - Phase 1: Pattern-Based Detection
 *
 * This module identifies posts that are likely self-promotion or marketing content
 * disguised as genuine problem discussions.
 */

export interface BaitDetectionResult {
  isBait: boolean;
  score: number; // 0-100, higher = more likely bait
  method: "pattern" | "subreddit" | "combined";
  redFlags: string[];
  reasoning: string;
}

// Promotional phrase patterns
const PROMOTIONAL_PATTERNS = [
  // Direct promotion - expanded patterns
  /\b(i've built|i built|i created|i developed|i made|i'm building|i am building|i'm working on|i am working on|i've made|i made a)\b/i,
  /\b(check out|checkout|try my|test my|my new|our new|we built|we created|we developed|we're launching|we've built)\b/i,
  /\b(launching|launching soon|pre-launch|just launched|finally launched|now available)\b/i,
  /\b(my startup|my company|our startup|our company|my saas|our saas|my product|our product)\b/i,

  // Call to action patterns - expanded
  /\b(try it out|give it a try|feel free to try|happy to share|let me know if you want)\b/i,
  /\b(sign up|join now|get early access|beta testers wanted|looking for beta testers|looking for feedback)\b/i,
  /\b(dm me|message me|contact me|reach out to|interested in feedback|please check it out|please check it)\b/i,

  // Question-marketing (problem + solution)
  /\b(does anyone know|any recommendations|looking for|anyone know of|need a tool for)\b.*\b(actually i built|but i built|turns out i built|i ended up building|i made)\b/i,

  // Fake pain + pitch
  /\b(why is every|why are all|why do all|i hate how|i can't believe how)\b.*\b(so i built|so i created|so i made|that's why i)\b/i,

  // Humblebrag patterns - expanded
  /\b(i was frustrated|i was tired of|i struggled with|i couldn't find|i hate how)\b.*\b(so i built|so i created|so i made|that's why i|so i decided to|i ended up)\b/i,

  // Affiliate/commercial indicators
  /\b(use my code|use this link|affiliate|referral|commission|discount code|ref=|aff=)\b/i,
  /\b(bit\.ly|tinyurl|ref\.|\.ref|aff\.|promo=|\.referral)\b/i,

  // Solution-focused language (prescriptive vs descriptive)
  /\b(you should use|you need to|i recommend|i suggest|best way to is|i've discovered)\b/i,

  // External tool/project links
  /\b(github\.com|gitlab\.com|bitbucket\.org|producthunt\.com|indiehackers\.com)\b/i,

  // Success story + link pattern
  /\b(it actually works|pretty sure i've|i've discovered|i can now)\b.*(github|check it out|give feedback|try it)\b/i,
];

// Subreddits known for promotional content
const PROMOTIONAL_SUBREDDITS = [
  "startups",
  "sideproject",
  "entrepreneur",
  "Entrepreneur",
  "saas",
  "SaaS",
  "roastmystartup",
  "startup",
  "SideProject",
  "SelfPromotion",
  "shamelessplug",
  "promote",
  "marketing",
  "digitalmarketing",
  "nocode",
  "NoCode",
  "Entrepreneurship",
  "entrepreneurship",
  "SaaS",
  "IndieHackers",
  "indiehackers",
];

// Score thresholds
const SUBREDDIT_BONUS = 30; // Add 30 points if from promotional subreddit
const PATTERN_MATCH_SCORE = 30; // Add 30 points per pattern match (increased from 25)
const EXTERNAL_LINK_BONUS = 20; // Add 20 points for external tool links
const SUCCESS_STORY_BONUS = 15; // Add 15 points for "it works" + link pattern

/**
 * Detect if a post is likely promotional/bait content
 */
export function detectBait(post: {
  title: string;
  content: string | null;
  subreddit: string | null;
}): BaitDetectionResult {
  const redFlags: string[] = [];
  let score = 0;
  let method: "pattern" | "subreddit" | "combined" = "pattern";

  // Combine title and content for analysis
  const textToAnalyze = `${post.title} ${post.content || ""}`.toLowerCase();

  // Check 1: Subreddit blacklist
  const isPromotionalSubreddit =
    post.subreddit &&
    PROMOTIONAL_SUBREDDITS.some(
      (sub) => sub.toLowerCase() === post.subreddit?.toLowerCase(),
    );

  if (isPromotionalSubreddit) {
    score += SUBREDDIT_BONUS;
    redFlags.push(`Posted in promotional subreddit: r/${post.subreddit}`);
    method = "subreddit";
  }

  // Check 2: Pattern matching
  const matchedPatterns: string[] = [];

  for (const pattern of PROMOTIONAL_PATTERNS) {
    const matches = textToAnalyze.match(pattern);
    if (matches) {
      score += PATTERN_MATCH_SCORE;
      // Extract the matched phrase for the flag
      const matchedText = matches[0].toLowerCase();

      // Categorize the flag
      if (
        matchedText.includes("i built") ||
        matchedText.includes("i created") ||
        matchedText.includes("i made")
      ) {
        matchedPatterns.push(
          "Self-promotion: mentions building/creating a solution",
        );
      } else if (
        matchedText.includes("check out") ||
        matchedText.includes("try my")
      ) {
        matchedPatterns.push("Call to action: promoting a specific solution");
      } else if (
        matchedText.includes("launching") ||
        matchedText.includes("startup")
      ) {
        matchedPatterns.push("Launch/promotion language");
      } else if (
        matchedText.includes("affiliate") ||
        matchedText.includes("referral")
      ) {
        matchedPatterns.push("Affiliate/commercial content detected");
      } else if (
        matchedText.includes("you should") ||
        matchedText.includes("you need to")
      ) {
        matchedPatterns.push("Prescriptive language (pushing a solution)");
      } else if (
        matchedText.includes("github") ||
        matchedText.includes("gitlab") ||
        matchedText.includes("producthunt")
      ) {
        matchedPatterns.push("External tool/project link detected");
      } else if (
        matchedText.includes("it actually works") ||
        matchedText.includes("i can now") ||
        matchedText.includes("i've discovered")
      ) {
        matchedPatterns.push("Success story + promotional pattern");
      } else {
        matchedPatterns.push(
          `Promotional pattern: "${matches[0].slice(0, 50)}"`,
        );
      }
    }
  }

  // Check 3: Excessive self-references (I/my/we 15+ times)
  const selfReferences = (
    textToAnalyze.match(/\b(i|my|me|we|our|us)\b/gi) || []
  ).length;
  const totalWords = textToAnalyze.split(/\s+/).length;
  const selfReferenceRatio = totalWords > 0 ? selfReferences / totalWords : 0;

  if (selfReferenceRatio > 0.15 && totalWords > 50) {
    score += 20;
    matchedPatterns.push(
      "High self-reference ratio (focused on self, not the problem)",
    );
  }

  // Check 4: URL patterns (landing pages, product links)
  const urlPatterns = /https?:\/\/[^\s]+/gi;
  const urls = textToAnalyze.match(urlPatterns) || [];

  for (const url of urls) {
    const lowerUrl = url.toLowerCase();
    // Skip Reddit and HackerNews internal links
    if (
      lowerUrl.includes("reddit.com") ||
      lowerUrl.includes("news.ycombinator.com")
    ) {
      continue;
    }

    // Check for common landing page/product indicators
    if (
      lowerUrl.includes(".app") ||
      lowerUrl.includes(".io") ||
      lowerUrl.includes("producthunt") ||
      lowerUrl.includes("launch") ||
      lowerUrl.match(/\/(signup|register|join|get-started)/)
    ) {
      score += 15;
      matchedPatterns.push("Contains product/promotional URL");
      break; // Only flag once
    }
  }

  redFlags.push(...matchedPatterns);

  // Update method if both subreddit and patterns matched
  if (isPromotionalSubreddit && matchedPatterns.length > 0) {
    method = "combined";
  }

  // Normalize score to 0-100
  score = Math.min(100, Math.max(0, score));

  // Determine if bait based on score
  const isBait = score >= 70;

  // Generate reasoning
  let reasoning = "";
  if (score === 0) {
    reasoning =
      "No promotional indicators detected. Appears to be a genuine discussion.";
  } else if (score < 40) {
    reasoning =
      "Minor promotional elements detected, but likely genuine problem discussion.";
  } else if (score < 70) {
    reasoning =
      "Some promotional elements present. Review recommended before considering as opportunity.";
  } else {
    reasoning =
      "Strong promotional indicators detected. Likely disguised self-promotion or marketing content.";
  }

  return {
    isBait,
    score,
    method,
    redFlags,
    reasoning,
  };
}

/**
 * Get filter threshold based on filter level
 */
export function getBaitThreshold(
  filterLevel: "strict" | "balanced" | "inclusive",
): number {
  switch (filterLevel) {
    case "strict":
      return 20; // Filter anything with 20+ bait score
    case "balanced":
      return 50; // Filter anything with 50+ bait score (default)
    case "inclusive":
      return 80; // Only filter obvious bait (80+)
    default:
      return 50;
  }
}

/**
 * Check if a post should be filtered based on bait score and filter level
 */
export function shouldFilterPost(
  baitScore: number,
  filterLevel: "strict" | "balanced" | "inclusive",
): boolean {
  const threshold = getBaitThreshold(filterLevel);
  return baitScore >= threshold;
}
