# Reddit Leadgen API Integration & IP Blocking

This document outlines the architecture and known issues for the Reddit fetcher in the Leadgen Bot, specifically detailing how we bypass Reddit's aggressive anti-bot IP blocking.

## The Problem: Reddit Blocks GitHub Actions

Reddit employs Cloudflare and strict anti-bot measures to heavily rate-limit and block traffic originating from CI/CD platforms (GitHub Actions, GitLab CI), Cloud Providers (AWS, GCP, Azure), and known datacenter IP ranges.

When the leadgen bot attempts to fetch Reddit data from these blocked IP ranges, Reddit will return:
* **HTTP 403 Forbidden** on the `reddit.com/r/{sub}/new.json` REST API endpoints.
* **Empty Responses / Captcha Pages** on the `reddit.com/r/{sub}/new/.rss` endpoints (which RSS parsers quietly interpret as an empty feed of `[]`).

This results in the bot fetching 0 leads from Reddit while appearing to run successfully. Local executions (from residential or typical office IPs) will usually work, making this failure mode tricky to debug since it only fails in production.

## The Solution: Arctic Shift Mirror API

To bypass Reddit's IP blocks, we do not hit `reddit.com` directly. Instead, we use **Arctic Shift** (`arctic-shift.photon-reddit.com`), which is a reliable, open-source Reddit API mirror designed for data preservation and search.

### Key Benefits
1. **No CI IP blocking**: Arctic Shift does not block GitHub Actions or AWS IP ranges.
2. **Identical Schema**: Arctic Shift's `/api/posts/search` endpoint returns the exact same underlying `RedditPost` JSON objects as the official Reddit API.
3. **No Authentication**: It doesn't require OAuth keys (unlike the official Reddit API which requires setting up a registered Reddit App).

### Implementation Details (`src/sources/reddit.ts`)

We fetch latest posts using a query like:
```typescript
const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&limit=25`;
```

The response format is:
```typescript
interface RedditListing {
    data: RedditPost[]; // Array of standard Reddit post objects
}
```

The data mapping works flawlessly because `RedditPost.title`, `RedditPost.selftext`, `RedditPost.author`, etc., are unchanged from the official API.

## Fallback & Escalation Options

If Arctic Shift ever goes down or starts blocking traffic:

1. **PullPush.io**: Another Reddit ingest mirror (`https://api.pullpush.io`).
2. **Official Reddit OAuth API**: You can register a script app at `reddit.com/prefs/apps`, get a Client ID/Secret, and fetch an OAuth bearer token before hitting the `oauth.reddit.com` endpoint. This is fully supported by Reddit but requires managing credentials. (GitHub Actions IPs with valid User-Agents and OAuth tokens are generally permitted by Reddit).
3. **Apify / ScrapingBee**: Paid API proxy services that rotate residential proxies to fetch the original `reddit.com` endpoints.

## Debugging

If the bot stops fetching Reddit leads again:
1. Check the GitHub Actions run logs (Expand the `npm start` step).
2. Look for `❌ r/{subreddit}: HTTP {status}` logs.
3. If it says `HTTP 502/503`, Arctic Shift might be temporarily down.
4. If it says `empty listing`, verify the subreddit still exists and hasn't gone private.
