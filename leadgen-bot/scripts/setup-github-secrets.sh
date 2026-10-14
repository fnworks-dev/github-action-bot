#!/bin/bash
#
# Setup GitHub Secrets for Leadgen Bot using gh CLI
#
# Usage: ./scripts/setup-github-secrets.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

echo "🔧 Leadgen Bot - GitHub Secrets Setup"
echo "======================================"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo ""
    echo "Install it:"
    echo "  macOS:     brew install gh"
    echo "  Ubuntu:    sudo apt install gh"
    echo "  Windows:   winget install --id GitHub.cli"
    echo ""
    echo "Or visit: https://cli.github.com/"
    exit 1
fi

# Check if user is authenticated
echo "🔍 Checking GitHub authentication..."
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub."
    echo ""
    echo "Run: gh auth login"
    exit 1
fi
echo "✅ Authenticated with GitHub"
echo ""

# Get repository
echo "🔍 Detecting repository..."
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")

if [ -z "$REPO" ]; then
    echo "❌ Could not detect repository."
    echo ""
    echo "Make sure you're in a Git repository connected to GitHub."
    echo "Or set it manually:"
    echo "  gh repo set-default OWNER/REPO"
    exit 1
fi

echo "✅ Repository: $REPO"
echo ""

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env file not found at $ENV_FILE"
    echo ""
    echo "Create one first: cp .env.example .env"
    exit 1
fi

# Function to set secret
set_secret() {
    local name=$1
    local value=$2
    
    if [ -z "$value" ]; then
        echo "   ⚠️  $name is empty, skipping..."
        return
    fi
    
    echo -n "$value" | gh secret set "$name" --repo "$REPO" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "   ✅ $name"
    else
        echo "   ❌ Failed to set $name"
    fi
}

# Function to set secret from env var
set_secret_from_env() {
    local name=$1
    local value=$(grep "^${name}=" "$ENV_FILE" | cut -d '=' -f2- | sed 's/^["'"'"']//;s/["'"'"']$//')
    set_secret "$name" "$value"
}

echo "📤 Setting secrets from .env file..."
echo ""

# Required secrets
echo "🔐 Required Secrets:"
set_secret_from_env "TURSO_DATABASE_URL"
set_secret_from_env "TURSO_AUTH_TOKEN"
set_secret_from_env "DISCORD_WEBHOOK_URL"
echo ""

# AI secrets (at least one required)
echo "🤖 AI Secrets (at least one required):"
set_secret_from_env "GEMINI_API_KEYS"
echo ""

# Twitter/X secrets
echo "🐦 Twitter/X Secrets:"
set_secret_from_env "TWITTER_SOURCE"
set_secret_from_env "TWITTERAPI_KEY"
set_secret_from_env "TWITTER_ENABLED"
echo ""

# ProductHunt secrets
echo "🚀 ProductHunt Secrets:"
set_secret_from_env "PRODUCTHUNT_API_TOKEN"
echo ""

# Optional secrets
echo "⚙️  Optional Secrets:"
set_secret_from_env "MIN_SCORE_THRESHOLD"
set_secret_from_env "SOURCES"
echo ""

echo "======================================"
echo "✅ Secrets setup complete!"
echo ""
echo "To verify secrets are set:"
echo "  gh secret list --repo $REPO"
echo ""
echo "To trigger the workflow manually:"
echo "  gh workflow run leadgen-bot.yml --repo $REPO"
echo ""
echo "To view workflow runs:"
echo "  gh run list --repo $REPO --workflow=leadgen-bot.yml"
