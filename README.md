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

## Why This Repository Exists

GitHub Actions provides **unlimited free minutes** for public repositories, but private repositories are limited to 2,000 minutes/month.

By hosting automation workflows in this public repository, we can:
- Run frequent tasks (e.g., every 10 minutes) without hitting usage limits
- Keep the main backend repository private for security
- Separate automation logic from application code

## Security

- This repository contains **no sensitive code** or credentials
- All workflows only ping public endpoints
- Secrets and API keys remain in the private repositories
