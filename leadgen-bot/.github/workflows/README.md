# GitHub Actions - Leadgen Bot

This workflow runs the lead generation bot automatically every 6 hours.

## 🚀 Quick Start

### 1. Install GitHub CLI

```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# Windows
winget install --id GitHub.cli
```

### 2. Authenticate

```bash
gh auth login
```

### 3. Set Repository (if needed)

```bash
gh repo set-default fnworks-dev/fnworks.dev-leadgen
```

### 4. Set Secrets

```bash
# From .env file
./scripts/setup-github-secrets.sh

# Or manually
gh secret set TURSO_DATABASE_URL --repo fnworks-dev/fnworks.dev-leadgen
gh secret set TURSO_AUTH_TOKEN --repo fnworks-dev/fnworks.dev-leadgen
gh secret set DISCORD_WEBHOOK_URL --repo fnworks-dev/fnworks.dev-leadgen
# ... etc
```

### 5. Run Workflow

```bash
# Trigger manually
./scripts/manage-gh-workflow.sh run

# With specific sources
./scripts/manage-gh-workflow.sh run --sources indiehackers,producthunt

# View runs
./scripts/manage-gh-workflow.sh runs

# Watch latest run
./scripts/manage-gh-workflow.sh watch
```

## 📋 Available Commands

```bash
./scripts/manage-gh-workflow.sh [command]

Commands:
  setup-secrets    Set GitHub secrets from .env file
  list-secrets     List all configured secrets
  delete-secret    Delete a specific secret
  run              Trigger workflow manually
  runs             View recent workflow runs
  logs             View logs from latest run
  watch            Watch the latest run in real-time
  enable           Enable the workflow
  disable          Disable the workflow
  status           Check workflow status
  sync-env         Sync .env to GitHub secrets
```

## 🔐 Required Secrets

| Secret | Description |
|--------|-------------|
| `TURSO_DATABASE_URL` | Turso database URL |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `DISCORD_WEBHOOK_URL` | Discord webhook for notifications |

## 🤖 Optional Secrets

| Secret | Description | Default |
|--------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | - |
| `GLM_API_KEY` | GLM/Z.ai API key | - |
| `TWITTERAPI_KEY` | TwitterAPI.io key | - |
| `PRODUCTHUNT_API_TOKEN` | ProductHunt API token | - |
| `MIN_SCORE_THRESHOLD` | Min score for Discord notify | `6` |
| `SOURCES` | Sources to run | `reddit,hackernews,indiehackers` |

## ⏰ Schedule

The bot runs every 6 hours at:
- 00:00 UTC
- 06:00 UTC
- 12:00 UTC
- 18:00 UTC

## 🔧 Manual Trigger

You can trigger the workflow manually with custom sources:

1. Go to **Actions** → **Leadgen Bot**
2. Click **Run workflow**
3. Optionally specify sources (e.g., `indiehackers,producthunt`)
4. Click **Run workflow**

Or via CLI:

```bash
gh workflow run leadgen-bot.yml -f sources="indiehackers,producthunt"
```

## 📊 Monitoring

```bash
# View recent runs
gh run list --workflow=leadgen-bot.yml

# View specific run
gh run view <run-id>

# View logs
gh run view <run-id> --log

# Watch running workflow
gh run watch <run-id>
```
