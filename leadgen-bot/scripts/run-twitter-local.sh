#!/bin/bash
#
# Local Twitter Scraper Runner
# 
# Runs the DIY Twitter scraper locally with proper environment setup.
# Usage: ./scripts/run-twitter-local.sh
#
# Note: For scheduled runs with sleep detection, use twitter-daemon.sh instead
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Twitter DIY Scraper - Local Runner${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "$PROJECT_DIR/package.json" ]; then
    echo -e "${RED}ERROR: package.json not found${NC}"
    echo "Please run this script from the leadgen-bot directory"
    exit 1
fi

cd "$PROJECT_DIR"

# Load .env file if it exists
if [ -f ".env" ]; then
    echo -e "${BLUE}Loading environment from .env...${NC}"
    set -a
    source .env
    set +a
fi

# Default configuration
export TWITTER_SOURCE="${TWITTER_SOURCE:-diy}"
export TWITTER_ENABLED="${TWITTER_ENABLED:-true}"
export TWITTER_COOKIES_PATH="${TWITTER_COOKIES_PATH:-./cookies/twitter_session.json}"
export SOURCES="${SOURCES:-twitter}"

echo -e "${BLUE}Configuration:${NC}"
echo "  TWITTER_SOURCE: $TWITTER_SOURCE"
echo "  TWITTER_ENABLED: $TWITTER_ENABLED"
echo "  TWITTER_COOKIES_PATH: $TWITTER_COOKIES_PATH"
echo "  SOURCES: $SOURCES"
echo ""

# Check Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}ERROR: python3 is not installed${NC}"
    exit 1
fi

# Check for required Python packages
echo -e "${BLUE}Checking Python dependencies...${NC}"

if ! python3 -c "import playwright" 2>/dev/null; then
    echo -e "${YELLOW}WARNING: playwright not installed${NC}"
    echo "Installing Python dependencies..."
    pip3 install -r src/scripts/requirements.txt
    echo -e "${GREEN}Dependencies installed${NC}"
    echo ""
    echo -e "${YELLOW}NOTE: You may need to install browser binaries:${NC}"
    echo "  playwright install chromium"
    echo ""
fi

# Check cookies file exists
if [ ! -f "$TWITTER_COOKIES_PATH" ]; then
    echo -e "${RED}ERROR: Cookies file not found: $TWITTER_COOKIES_PATH${NC}"
    echo ""
    echo "To set up cookies:"
    echo "  1. Export cookies from your browser using Cookie-Editor extension"
    echo "  2. Save to cookies/twitter_session.json"
    echo "  3. Or run: python3 src/scripts/save_session.py"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ Cookies file found${NC}"
echo ""

# Check if TypeScript is built
if [ ! -d "dist" ] || [ ! -f "dist/index.js" ]; then
    echo -e "${BLUE}Building TypeScript...${NC}"
    npm run build
    echo ""
fi

# Run the bot
echo -e "${GREEN}Starting Twitter scraper...${NC}"
echo ""

node dist/index.js

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ Scraper completed successfully${NC}"
else
    echo -e "${RED}✗ Scraper failed with exit code $EXIT_CODE${NC}"
fi

exit $EXIT_CODE
