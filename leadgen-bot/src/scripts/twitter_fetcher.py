#!/usr/bin/env python3
"""
Twitter/X Lead Fetcher using Playwright with Stealth Features.

Uses playwright-stealth for anti-detection and saved cookies for authentication.
"""

import asyncio
import json
import sys
import os
import random
from datetime import datetime, timedelta
from typing import Optional, List, Dict

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

PLAYWRIGHT_TYPE = "playwright+stealth"

# Configuration from environment
TWITTER_ENABLED = os.getenv('TWITTER_ENABLED', 'false').lower() == 'true'
TWITTER_COOKIES_PATH = os.getenv('TWITTER_COOKIES_PATH', '')
MAX_HOURS_OLD = int(os.getenv('TWITTER_SEARCH_HOURS', '24'))
MAX_RESULTS = int(os.getenv('TWITTER_MAX_RESULTS', '20'))

# Negative filters - skip self-promotion
NEGATIVE_FILTERS = [
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
]

# Search queries for hiring intent (limited for speed)
SEARCH_QUERIES = [
    'looking for developer',
    'hiring developer', 
    'need developer',
    'looking for cofounder',
]


# Logging helper (stderr to avoid interfering with JSON output)
def log_info(msg: str):
    print(f"[INFO] {msg}", file=sys.stderr)

def log_error(msg: str):
    print(f"[ERROR] {msg}", file=sys.stderr)

def log_warning(msg: str):
    print(f"[WARN] {msg}", file=sys.stderr)

def log_debug(msg: str):
    print(f"[DEBUG] {msg}", file=sys.stderr)


def is_fresh(posted_at: datetime) -> bool:
    """Check if tweet is within the time window."""
    cutoff = datetime.now(posted_at.tzinfo) - timedelta(hours=MAX_HOURS_OLD)
    return posted_at > cutoff


def matches_negative_filters(text: str) -> bool:
    """Check if text matches any negative filter."""
    text_lower = text.lower()
    return any(f.lower() in text_lower for f in NEGATIVE_FILTERS)


class HumanBehavior:
    """Simulate realistic human-like behavior patterns."""

    @staticmethod
    async def random_delay(min_ms: int = 500, max_ms: int = 2000):
        """Add a random delay to mimic human response time."""
        delay = random.uniform(min_ms, max_ms) / 1000
        await asyncio.sleep(delay)

    @staticmethod
    async def human_like_scroll(page, num_scrolls: int = 3):
        """Scroll naturally with variable speed and pauses."""
        log_debug(f"  Performing {num_scrolls} human-like scrolls...")

        for i in range(num_scrolls):
            scroll_distance = random.randint(300, 800)
            current_position = await page.evaluate("window.pageYOffset")
            target = current_position + scroll_distance

            while current_position < target:
                step = random.randint(50, 150)
                current_position = min(current_position + step, target)
                await page.evaluate(f"window.scrollTo(0, {current_position})")
                await asyncio.sleep(random.uniform(0.01, 0.05))

            await HumanBehavior.random_delay(1000, 2500)


class SelectorRegistry:
    """Multiple fallback selectors for each element type."""

    TWEET_CONTAINERS = [
        'article[data-testid="tweet"]',
        'div[data-testid="cellInnerDiv"] article',
        '[role="article"]',
    ]

    TWEET_TEXT = [
        'div[data-testid="tweetText"]',
        'div[lang]',
    ]

    AUTHOR = [
        'a[role="link"]',
        'div[data-testid="User-Name"] a',
    ]

    TIMESTAMP = [
        'time',
        '[datetime]',
    ]


class RobustExtractor:
    """Extract data with multiple selector fallbacks."""

    def __init__(self, page, tweet_index: int = 0):
        self.page = page
        self.tweet_index = tweet_index

    async def extract_text(self, tweet) -> Optional[str]:
        """Extract tweet text with fallback selectors."""
        for selector in SelectorRegistry.TWEET_TEXT:
            try:
                elem = await tweet.query_selector(selector)
                if elem:
                    text = await elem.inner_text()
                    if text and len(text.strip()) > 5:
                        return text.strip()
            except Exception:
                continue
        return None

    async def extract_author(self, tweet) -> str:
        """Extract author with fallback selectors."""
        for selector in SelectorRegistry.AUTHOR:
            try:
                elem = await tweet.query_selector(selector)
                if elem:
                    href = await elem.get_attribute('href')
                    if href:
                        return href.strip('/').split('/')[0]
            except Exception:
                continue
        return 'Unknown'

    async def extract_url(self, tweet) -> Optional[tuple[str, str]]:
        """Extract tweet URL and ID."""
        try:
            link_elem = await tweet.query_selector('a[href*="/status/"]')
            if link_elem:
                href = await link_elem.get_attribute('href')
                if href and '/status/' in href:
                    tweet_id = href.split('/status/')[-1].split('?')[0].split('/')[0]
                    source_url = f"https://x.com{href}"
                    return source_url, tweet_id
        except Exception:
            pass
        return None, None

    async def extract_time(self, tweet) -> Optional[datetime]:
        """Extract timestamp with fallback selectors."""
        for selector in SelectorRegistry.TIMESTAMP:
            try:
                elem = await tweet.query_selector(selector)
                if elem:
                    time_str = await elem.get_attribute('datetime')
                    if time_str:
                        try:
                            return datetime.fromisoformat(time_str.replace('Z', '+00:00'))
                        except Exception:
                            continue
            except Exception:
                continue
        return datetime.now()


async def scrape_search(page, query: str) -> list:
    """Scrape tweets from a search results page."""
    results = []
    search_url = f"https://x.com/search?q={query}&src=typed_query&f=live"

    log_info(f"Starting query: '{query}'")
    log_debug(f"  URL: {search_url}")

    try:
        await HumanBehavior.random_delay(1000, 2000)
        
        # Navigate to search
        await page.goto(search_url, wait_until='domcontentloaded', timeout=60000)
        log_debug("  Page loaded, waiting for content...")

        # Wait for tweets to appear
        try:
            await page.wait_for_selector('article[data-testid="tweet"]', timeout=10000)
            log_debug("  Tweets loaded")
        except:
            log_warning("  Tweets didn't load within 10s, trying anyway...")

        # Scroll to load more
        await HumanBehavior.human_like_scroll(page, num_scrolls=2)

        # Find tweets
        tweets = []
        for selector in SelectorRegistry.TWEET_CONTAINERS:
            try:
                found = await page.query_selector_all(selector)
                if found:
                    log_debug(f"  Found {len(found)} tweets using selector: {selector}")
                    tweets = found
                    break
            except Exception:
                continue

        if not tweets:
            log_warning("  No tweet elements found")
            return results

        log_info(f"  Processing {min(len(tweets), MAX_RESULTS)} tweets")

        extractor = RobustExtractor(page)

        for idx, tweet in enumerate(tweets[:MAX_RESULTS]):
            try:
                text = await extractor.extract_text(tweet)
                if not text:
                    continue

                author = await extractor.extract_author(tweet)
                source_url, tweet_id = await extractor.extract_url(tweet)
                
                if not source_url or not tweet_id:
                    continue

                posted_at = await extractor.extract_time(tweet)
                if not is_fresh(posted_at):
                    continue

                if matches_negative_filters(text):
                    continue

                results.append({
                    'source': 'x',
                    'sourceId': tweet_id,
                    'sourceUrl': source_url,
                    'title': text[:100] + ('...' if len(text) > 100 else ''),
                    'content': text,
                    'author': author,
                    'subreddit': None,
                    'postedAt': posted_at.isoformat(),
                })
                log_info(f"  ✓ Tweet {idx+1}: @{author}")

            except Exception as e:
                log_error(f"  Tweet {idx+1}: Failed to process: {e}")
                continue

    except Exception as e:
        log_error(f"Query '{query}' failed: {e}")

    log_info(f"Query '{query}' complete: {len(results)} results")
    return results


def load_cookies_from_file(cookies_path: str) -> List[Dict]:
    """Load cookies from JSON file."""
    if not os.path.exists(cookies_path):
        raise FileNotFoundError(f"Cookies file not found: {cookies_path}")
    
    with open(cookies_path, 'r') as f:
        data = json.load(f)
    
    cookies = data.get('cookies', [])
    if not cookies:
        raise ValueError("No cookies found in file")
    
    has_auth = any(c.get('name') == 'auth_token' for c in cookies)
    has_ct0 = any(c.get('name') == 'ct0' for c in cookies)
    
    if not has_auth:
        raise ValueError("Missing required cookie: auth_token")
    if not has_ct0:
        raise ValueError("Missing required cookie: ct0")
    
    return cookies


async def main():
    log_info("=" * 60)
    log_info("Twitter/X Fetcher Starting")
    log_info(f"Playwright Type: {PLAYWRIGHT_TYPE}")
    log_info("=" * 60)
    log_info(f"TWITTER_ENABLED: {TWITTER_ENABLED}")
    log_info(f"TWITTER_COOKIES_PATH: {TWITTER_COOKIES_PATH}")
    log_info(f"TWITTER_SEARCH_HOURS: {MAX_HOURS_OLD}")
    log_info(f"TWITTER_MAX_RESULTS: {MAX_RESULTS}")
    log_info(f"Number of queries: {len(SEARCH_QUERIES)}")

    if not TWITTER_ENABLED:
        log_warning("Twitter is disabled via TWITTER_ENABLED flag")
        print(json.dumps([]))
        sys.exit(0)

    if not TWITTER_COOKIES_PATH:
        log_error("No TWITTER_COOKIES_PATH environment variable found")
        print(json.dumps([]))
        sys.exit(1)

    try:
        cookies = load_cookies_from_file(TWITTER_COOKIES_PATH)
        log_info(f"Loaded {len(cookies)} cookies from file")
    except FileNotFoundError as e:
        log_error(f"Cookies file not found: {e}")
        print(json.dumps([]))
        sys.exit(1)
    except json.JSONDecodeError as e:
        log_error(f"Invalid JSON in cookies file: {e}")
        print(json.dumps([]))
        sys.exit(1)
    except ValueError as e:
        log_error(f"Invalid cookies: {e}")
        print(json.dumps([]))
        sys.exit(1)

    log_info("Launching browser with stealth features...")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            log_info("Browser launched successfully")

            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                locale='en-US',
                timezone_id='America/New_York',
            )

            # Add cookies
            await context.add_cookies(cookies)
            log_info("Cookies added to browser context")

            # Apply stealth
            stealth = Stealth()
            await stealth.apply_stealth_async(context)
            log_info("Stealth features applied")

            page = await context.new_page()

            all_results = []

            for idx, query in enumerate(SEARCH_QUERIES, 1):
                log_info(f"Query {idx}/{len(SEARCH_QUERIES)}: {query}")
                tweets = await scrape_search(page, query)
                all_results.extend(tweets)

                if idx < len(SEARCH_QUERIES):
                    await HumanBehavior.random_delay(3000, 6000)

            await browser.close()
            log_info("Browser closed")

            # Deduplicate
            seen = set()
            unique_results = []
            for r in all_results:
                if r['sourceId'] and r['sourceId'] not in seen:
                    seen.add(r['sourceId'])
                    unique_results.append(r)

            log_info(f"Deduplication: {len(all_results)} -> {len(unique_results)} results")
            log_info(f"Final results count: {len(unique_results)}")
            log_info("=" * 60)

            print(json.dumps(unique_results))
            sys.exit(0)

    except Exception as e:
        log_error(f"Fatal error during scraping: {e}")
        import traceback
        log_error(f"Traceback: {traceback.format_exc()}")
        print(json.dumps([]))
        sys.exit(1)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log_error("Interrupted by user")
        sys.exit(1)
    except Exception as e:
        log_error(f"Unhandled exception: {e}")
        import traceback
        log_error(f"Traceback: {traceback.format_exc()}")
        print(json.dumps([]))
        sys.exit(1)
