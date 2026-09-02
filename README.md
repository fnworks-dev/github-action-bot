# GitHub Action Bots

This repository contains GitHub Actions workflows for automating routine tasks for FNworks services.

## Purpose

This public repository is used to run GitHub Actions with unlimited free minutes, helping to:
- Keep backend services alive (prevent cold starts on free tier hosting)
- Automate routine maintenance tasks
- Monitor service health

## Workflows

### Keep Backend Alive

**File**: `.github/workflows/keep-backend-alive.yml`

- **Schedule**: Every 10 minutes
- **Purpose**: Pings the FNworks backend health endpoint to prevent Render free tier from spinning down the service
- **Target**: `https://fnworks-dev-backend-th12.onrender.com/health`

### Leadgen Bot (Reddit + Hacker News)

**File**: `.github/workflows/leadgen-bot.yml`

- **Schedule**: Every 2 hours
- **Purpose**: Scrapes Reddit and Hacker News for potential leads, scores them with AI, saves to database, and sends Discord notifications for high-quality leads
- **Source Code**: `leadgen-bot/`

### Leadgen Twitter Bot

**File**: `.github/workflows/leadgen-twitter-bot.yml`

- **Schedule**: Every 4 hours
- **Purpose**: Scrapes Twitter/X for potential leads using TwitterAPI.io, scores them with AI, saves to database, and sends Discord notifications
- **Source Code**: `leadgen-bot/`

### Research Bot (Problem Discovery)

**File**: `.github/workflows/research-bot.yml`

- **Schedule**: Daily at 00:00 WIB (17:00 UTC)
- **Purpose**: Discovers and analyzes problems from various sources, scores them for relevance, saves to database, and sends Discord notifications
- **Source Code**: `research-bot/`

### SideQuest Bots (Split Runs)

**Files**: `.github/workflows/sidequest-bot-01.yml` … `sidequest-bot-04.yml`

- **Schedule**: every 4 hours each, staggered — 01 at :00 (0,4,8…UTC), 02 at :30, 03/04 same pattern offset +2h; effective coverage every 2 hours
- **Purpose**: scrape Reddit hiring subreddits via Arctic Shift API, detect job intent, categorize profession, analyze, summarize, write to SideQuest `job_posts` (Turso/LibSQL)
- **Configs**: `sidequest-bot/src/configs/config-01.ts` (Dev+Artist) … `config-04.ts` (VA+Startups); selected via `CONFIG` env
- **Timeout**: 30 min per run (`timeout-minutes: 30`; raised for thinking-model latency)
- **Concurrency**: per-workflow group with `cancel-in-progress: true`
- **Legacy**: `.github/workflows/sidequest-bot.yml` is workflow_dispatch-only (dormant since 2026-02); split workflows are production

### SideQuest Backfill Summaries

**File**: `.github/workflows/sidequest-backfill-summaries.yml`

- **Trigger**: manual (`workflow_dispatch` only)
- **Purpose**: regenerate AI summaries for existing `job_posts` rows

#### AI Fallback Chain (SideQuest)

All AI tasks (intent detection, categorization, analysis, summaries) use `sidequest-bot/src/ai/client.ts`:

1. **Gemini cascade** — 3 keys × 5 models, key-major order:
   - `GEMINI_API_KEY` → `GEMINI_BACKUP_KEY_1` → `GEMINI_BACKUP_KEY_2`
   - Models per key: `gemma-4-31b-it` → `gemini-3.1-flash-lite-preview` → `gemini-3-flash-preview` → `gemini-2.5-flash` → `gemini-2.5-flash-lite`
2. **NVIDIA NIM cascade** — `nvidia/nemotron-3-super-120b-a12b` → `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (override via comma-separated `NIM_MODELS` env; `NIM_MODEL` = legacy single-model override)

Notes:
- `gemma-4-31b-it` is a thinking model; client extracts non-`thought` parts only (thinking text never leaks into parsed JSON)
- Thinking tokens count against `maxOutputTokens`; budgets: intent 1000, categorization 1500/1000 (batch), analysis 2500
- Retryable HTTP: 408/429/500/502/503/504. `SIDEQUEST_AI_MAX_ATTEMPTS=2` in CI; retry also happens via the key×model and NIM model cascades
- Per-request timeout: `SIDEQUEST_AI_TIMEOUT_MS=15000`
- NIM model history: `meta/llama-3.1-8b-instruct` hit NVIDIA EOL 2026-08-26; `nvidia/nemotron-3.5-lightning-30b-a3b` listed but unusable (inference hangs); `meta/muse-glimmer-30b` works but 20-30s/call, exceeds timeout; `mistralai/mistral-nemotron` returns 500s. If swapping NIM models, verify latency + JSON reliability in CI first
- Task-level fallbacks: keyword-based categorization and heuristic intent detection run when all AI providers fail
- **Fallback chain verified end-to-end in CI** (2026-09-02): Gemini-keys-dead → NIM serves; NIM primary dead → backup model serves; all dead → clean error
- **Run Health**: writes run tracking rows to `sidequest_runs`, fails on stale feed freshness beyond threshold
- **Optional Secrets**: `SIDEQUEST_REDDIT_CLIENT_ID`, `SIDEQUEST_REDDIT_CLIENT_SECRET` for Reddit OAuth fetches

#### Content Filtering (SideQuest)

Three-layer filter pipeline (all config variants share `sidequest-bot/src/filters.ts`):

1. **Fetch-time**: Reddit `over_18` flagged posts dropped immediately (both `index-split.ts` and `sources/reddit.ts`)
2. **NSFW keywords** (`isNsfwContent`): blocks posts offering/requesting adult work even when unflagged — nsfw, 18+, hentai, fetish, kink(s), lewd, nudes, r34, yiff, onlyfans, etc.
3. **Junk tightening** (`isJunkContent`): title-only `[For Hire]`/`[Hiring]` tags with no body, `discord.gg` invite spam, link-shortener spam (bit.ly, tinyurl, cutt.ly)

Plus existing per-config `negativeFilters` (self-promotion, advice-seeking, surveys, etc.) and AI hiring-intent detection (strict: rejects offers-of-service, commission schemes, vague posts).

### SideQuest Reliability

- **Failure alerting**: all 5 sidequest workflows post to Discord (`DISCORD_WEBHOOK_URL` secret) on `failure()`
- **Dead-man switch**: `.github/workflows/sidequest-deadman.yml` — hourly cron checks last success of each bot workflow; alerts Discord if any is >8h stale
- **Retry/timeout budget**: 2 attempts per provider tier, 15s per request, 30min per run

## Why This Repository Exists

GitHub Actions provides **unlimited free minutes** for public repositories, but private repositories are limited to 2,000 minutes/month.

By hosting automation workflows in this public repository, we can:
- Run frequent tasks (e.g., every 10 minutes) without hitting usage limits
- Keep the main backend repository private for security
- Separate automation logic from application code

## Security

- This repository contains **no sensitive code** or credentials
- All secrets are stored as GitHub repository secrets
- Database operations use environment variables only
