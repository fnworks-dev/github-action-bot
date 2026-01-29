#!/bin/bash
#
# Manage Leadgen Bot GitHub Actions Workflow using gh CLI
#
# Usage: ./scripts/manage-gh-workflow.sh [command]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get repository
get_repo() {
    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
    if [ -z "$REPO" ]; then
        echo -e "${RED}❌ Could not detect repository.${NC}"
        exit 1
    fi
    echo "$REPO"
}

# Check gh CLI
check_gh() {
    if ! command -v gh &> /dev/null; then
        echo -e "${RED}❌ GitHub CLI (gh) not installed.${NC}"
        echo "Install: https://cli.github.com/"
        exit 1
    fi
    
    if ! gh auth status &> /dev/null; then
        echo -e "${RED}❌ Not authenticated with GitHub.${NC}"
        echo "Run: ${YELLOW}gh auth login${NC}"
        exit 1
    fi
}

show_help() {
    echo "Leadgen Bot - GitHub Actions Manager"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  setup-secrets    Set GitHub secrets from .env file"
    echo "  list-secrets     List all configured secrets"
    echo "  delete-secret    Delete a specific secret"
    echo "  run              Trigger workflow manually"
    echo "  runs             View recent workflow runs"
    echo "  logs             View logs from latest run"
    echo "  watch            Watch the latest run in real-time"
    echo "  enable           Enable the workflow"
    echo "  disable          Disable the workflow"
    echo "  status           Check workflow status"
    echo "  sync-env         Sync .env to GitHub secrets (interactive)"
    echo ""
    echo "Examples:"
    echo "  $0 setup-secrets"
    echo "  $0 run"
    echo "  $0 runs --limit 10"
    echo "  $0 logs"
}

cmd_setup_secrets() {
    check_gh
    REPO=$(get_repo)
    
    echo -e "${BLUE}🔧 Setting up GitHub secrets for $REPO...${NC}"
    "$SCRIPT_DIR/setup-github-secrets.sh"
}

cmd_list_secrets() {
    check_gh
    REPO=$(get_repo)
    
    echo -e "${BLUE}🔐 Secrets configured for $REPO:${NC}"
    echo ""
    gh secret list --repo "$REPO"
}

cmd_delete_secret() {
    check_gh
    REPO=$(get_repo)
    
    if [ -z "${1:-}" ]; then
        echo -e "${YELLOW}Available secrets:${NC}"
        gh secret list --repo "$REPO"
        echo ""
        read -p "Enter secret name to delete: " secret_name
    else
        secret_name=$1
    fi
    
    echo -e "${YELLOW}Deleting secret: $secret_name${NC}"
    gh secret remove "$secret_name" --repo "$REPO"
    echo -e "${GREEN}✅ Secret deleted${NC}"
}

cmd_run() {
    check_gh
    REPO=$(get_repo)
    
    # Parse optional sources
    sources=""
    while [[ $# -gt 0 ]]; do
        case $1 in
            --sources)
                sources="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
    
    echo -e "${BLUE}🚀 Triggering workflow...${NC}"
    
    if [ -n "$sources" ]; then
        gh workflow run leadgen-bot.yml --repo "$REPO" -f sources="$sources"
        echo -e "${GREEN}✅ Workflow triggered with sources: $sources${NC}"
    else
        gh workflow run leadgen-bot.yml --repo "$REPO"
        echo -e "${GREEN}✅ Workflow triggered${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}Waiting a moment for run to start...${NC}"
    sleep 3
    
    # Get the latest run
    run_id=$(gh run list --repo "$REPO" --workflow=leadgen-bot.yml --limit 1 --json databaseId -q '.[0].databaseId')
    
    if [ -n "$run_id" ]; then
        echo ""
        echo -e "${BLUE}Latest run: https://github.com/$REPO/actions/runs/$run_id${NC}"
        echo ""
        echo "To watch: $0 watch"
        echo "To view logs: $0 logs"
    fi
}

cmd_runs() {
    check_gh
    REPO=$(get_repo)
    
    echo -e "${BLUE}📊 Recent workflow runs:${NC}"
    gh run list --repo "$REPO" --workflow=leadgen-bot.yml "$@"
}

cmd_logs() {
    check_gh
    REPO=$(get_repo)
    
    # Get the latest run
    run_id=$(gh run list --repo "$REPO" --workflow=leadgen-bot.yml --limit 1 --json databaseId -q '.[0].databaseId')
    
    if [ -z "$run_id" ]; then
        echo -e "${RED}❌ No runs found${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}📜 Logs for latest run (ID: $run_id):${NC}"
    gh run view "$run_id" --repo "$REPO" --log
}

cmd_watch() {
    check_gh
    REPO=$(get_repo)
    
    # Get the latest run
    run_id=$(gh run list --repo "$REPO" --workflow=leadgen-bot.yml --limit 1 --json databaseId -q '.[0].databaseId')
    
    if [ -z "$run_id" ]; then
        echo -e "${RED}❌ No runs found${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}👁️  Watching run $run_id...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop watching${NC}"
    echo ""
    
    gh run watch "$run_id" --repo "$REPO"
}

cmd_enable() {
    check_gh
    REPO=$(get_repo)
    
    echo -e "${BLUE}✅ Enabling workflow...${NC}"
    gh workflow enable leadgen-bot.yml --repo "$REPO"
    echo -e "${GREEN}✅ Workflow enabled${NC}"
}

cmd_disable() {
    check_gh
    REPO=$(get_repo)
    
    echo -e "${YELLOW}⏸️  Disabling workflow...${NC}"
    gh workflow disable leadgen-bot.yml --repo "$REPO"
    echo -e "${GREEN}✅ Workflow disabled${NC}"
}

cmd_status() {
    check_gh
    REPO=$(get_repo)
    
    echo -e "${BLUE}📋 Workflow Status:${NC}"
    echo ""
    
    # Check workflow status
    gh workflow view leadgen-bot.yml --repo "$REPO" --yaml 2>/dev/null | head -20
    
    echo ""
    echo -e "${BLUE}Recent runs:${NC}"
    gh run list --repo "$REPO" --workflow=leadgen-bot.yml --limit 5
}

cmd_sync_env() {
    check_gh
    REPO=$(get_repo)
    
    ENV_FILE="$PROJECT_DIR/.env"
    
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}❌ .env file not found${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}🔄 Syncing .env to GitHub secrets...${NC}"
    echo ""
    
    # Read .env file and set secrets
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        
        # Remove quotes from value
        value=$(echo "$value" | sed 's/^["'"'"']//;s/["'"'"']$//')
        
        if [ -n "$value" ]; then
            echo -n "   Setting $key... "
            echo -n "$value" | gh secret set "$key" --repo "$REPO" 2>/dev/null && echo -e "${GREEN}✅${NC}" || echo -e "${RED}❌${NC}"
        fi
    done < "$ENV_FILE"
    
    echo ""
    echo -e "${GREEN}✅ Sync complete!${NC}"
}

# Main
case "${1:-}" in
    setup-secrets)
        cmd_setup_secrets
        ;;
    list-secrets)
        cmd_list_secrets
        ;;
    delete-secret)
        shift
        cmd_delete_secret "$@"
        ;;
    run)
        shift
        cmd_run "$@"
        ;;
    runs)
        shift
        cmd_runs "$@"
        ;;
    logs)
        cmd_logs
        ;;
    watch)
        cmd_watch
        ;;
    enable)
        cmd_enable
        ;;
    disable)
        cmd_disable
        ;;
    status)
        cmd_status
        ;;
    sync-env)
        cmd_sync_env
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
