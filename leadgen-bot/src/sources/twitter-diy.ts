/**
 * Twitter DIY Scraper Source
 * 
 * Uses local Python Playwright scraper with cookies
 * for authenticated Twitter/X access.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { config } from '../config.js';
import { classifyError, isRetryableError, TwitterErrorType } from '../utils/error-classifier.js';
import type { RawPost } from '../types.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const SCRIPT_TIMEOUT_MS = 120000; // 2 minutes

// Search queries for hiring intent
const SEARCH_QUERIES = [
  'looking for developer',
  'hiring developer',
  'need developer',
  'looking for cofounder',
  'technical cofounder',
  'hire freelancer',
  'looking for agency',
];

// Negative filters - skip self-promotion
const NEGATIVE_FILTERS = [
  '[for hire]',
  'i am a developer',
  "i'm a developer",
  'i am available',
  'my portfolio',
  'hire me',
  'looking for work',
  'seeking work',
  'offering my services',
  'available for hire',
  'developer looking for',
  'open to work',
];

// Cookie types
export interface TwitterCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface TwitterCookieFile {
  cookies: TwitterCookie[];
  created_at?: string;
}

/**
 * Validate cookie file has required cookies
 */
export function validateCookies(cookieData: TwitterCookieFile): boolean {
  if (!cookieData || !Array.isArray(cookieData.cookies)) {
    return false;
  }

  const cookies = cookieData.cookies;
  const hasAuthToken = cookies.some((c) => c.name === 'auth_token');
  const hasCt0 = cookies.some((c) => c.name === 'ct0');

  return hasAuthToken && hasCt0;
}

/**
 * Transform Python scraper output to RawPost format
 */
export function transformTweetToRawPost(tweet: any): RawPost {
  return {
    source: 'x',
    sourceId: tweet.sourceId || tweet.id,
    sourceUrl: tweet.sourceUrl || tweet.url,
    title: tweet.title || tweet.text?.slice(0, 100) + (tweet.text?.length > 100 ? '...' : ''),
    content: tweet.content || tweet.text,
    author: tweet.author || tweet.username || null,
    subreddit: null,
    postedAt: tweet.postedAt || tweet.createdAt || null,
  };
}

/**
 * Check if post is fresh (within specified hours)
 */
export function isPostFresh(postedAt: string | null, hours: number = 24): boolean {
  if (!postedAt) return true; // Include if no date

  const postDate = new Date(postedAt);
  
  // Check if date is valid
  if (isNaN(postDate.getTime())) {
    return true; // Include if date parsing fails
  }
  
  const now = new Date();
  const diffMs = now.getTime() - postDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours <= hours;
}

/**
 * Check if text matches any negative filter
 */
export function matchesNegativeFilters(text: string): boolean {
  const textLower = text.toLowerCase();
  return NEGATIVE_FILTERS.some((filter) => textLower.includes(filter.toLowerCase()));
}

/**
 * Deduplicate posts by sourceId
 */
export function deduplicatePosts(posts: RawPost[]): RawPost[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    if (!post.sourceId || seen.has(post.sourceId)) {
      return false;
    }
    seen.add(post.sourceId);
    return true;
  });
}

/**
 * Load and validate cookies from file
 */
function loadCookies(cookiesPath: string): TwitterCookieFile {
  if (!existsSync(cookiesPath)) {
    throw new Error(`Cookies file not found: ${cookiesPath}`);
  }

  const content = readFileSync(cookiesPath, 'utf-8');
  let data: TwitterCookieFile;

  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in cookies file: ${cookiesPath}`);
  }

  if (!validateCookies(data)) {
    throw new Error(
      'Invalid cookies: missing required cookies (auth_token, ct0)'
    );
  }

  return data;
}

/**
 * Sleep utility for retries
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute Python scraper script
 */
async function executeScraper(
  cookiesPath: string,
  searchHours: number,
  maxResults: number,
  retryCount: number = 0
): Promise<{ stdout: string; stderr: string }> {
  // Path to Python script (in src/scripts, referenced from dist/sources)
  const scriptPath = join(__dirname, '../../src/scripts/twitter_fetcher.py');

  if (!existsSync(scriptPath)) {
    throw new Error(`Python script not found: ${scriptPath}`);
  }

  const env = {
    ...process.env,
    TWITTER_ENABLED: 'true',
    TWITTER_COOKIES_PATH: cookiesPath,
    TWITTER_SEARCH_HOURS: searchHours.toString(),
    TWITTER_MAX_RESULTS: maxResults.toString(),
  };

  try {
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath], {
      env,
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024, // 1MB buffer
    });

    return { stdout, stderr };
  } catch (error: any) {
    const errorType = classifyError(error);

    // Log stderr if available
    if (error.stderr) {
      console.error('Python stderr:', error.stderr.slice(0, 1000));
    }

    // Retry on transient errors
    if (isRetryableError(errorType) && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`⏳ Retrying after ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      await sleep(delay);
      return executeScraper(cookiesPath, searchHours, maxResults, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Main entry point: Fetch posts from Twitter/X using DIY scraper
 */
export async function fetchTwitterDiyPosts(): Promise<RawPost[]> {
  // Check if DIY source is enabled
  if (!config.twitter?.diy?.enabled) {
    console.log('⏭️ Twitter DIY source is disabled');
    return [];
  }

  const cookiesPath = config.twitter.diy.cookiesPath;
  const searchHours = config.twitter.diy.searchHours;
  const maxResults = config.twitter.diy.maxResults;

  console.log('📡 Fetching from Twitter/X (DIY scraper)...');
  console.log(`   Cookies: ${cookiesPath}`);
  console.log(`   Search window: ${searchHours} hours`);
  console.log(`   Max results: ${maxResults}`);

  // Validate cookies exist and are valid
  let cookies: TwitterCookieFile;
  try {
    cookies = loadCookies(cookiesPath);
    console.log(`✅ Loaded ${cookies.cookies.length} cookies`);
  } catch (error: any) {
    console.error('❌ Cookie validation failed:', error.message);
    return [];
  }

  // Execute Python scraper
  let stdout: string;
  try {
    const result = await executeScraper(cookiesPath, searchHours, maxResults);
    stdout = result.stdout;

    if (result.stderr) {
      console.log('📝 Scraper output:', result.stderr.slice(0, 500));
    }
  } catch (error: any) {
    const errorType = classifyError(error);
    console.error(`❌ Scraper failed [${errorType}]:`, error.message);
    return [];
  }

  // Parse JSON output
  let tweets: any[];
  try {
    tweets = JSON.parse(stdout);
    if (!Array.isArray(tweets)) {
      throw new Error('Expected JSON array');
    }
  } catch (error: any) {
    console.error('❌ Failed to parse scraper output:', error.message);
    console.error('Raw output (first 500 chars):', stdout.slice(0, 500));
    return [];
  }

  console.log(`📥 Fetched ${tweets.length} raw tweets`);

  // Transform and filter
  const posts = tweets
    .map(transformTweetToRawPost)
    .filter((post) => isPostFresh(post.postedAt, searchHours))
    .filter((post) => !matchesNegativeFilters(post.content || post.title));

  // Deduplicate
  const uniquePosts = deduplicatePosts(posts);

  console.log(`✅ Returning ${uniquePosts.length} unique posts`);

  return uniquePosts;
}
