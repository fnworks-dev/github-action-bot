#!/bin/bash
#
# Setup script for Twitter Bot Monitoring
# 
# This script:
# 1. Makes all scripts executable
# 2. Sets up cron job for health checks
# 3. Tests Discord webhook
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "Twitter Bot Monitoring Setup"
echo "========================================"
echo ""

# Make scripts executable
echo "Making scripts executable..."
chmod +x "$SCRIPT_DIR/health-check.sh"
chmod +x "$SCRIPT_DIR/watchdog.sh"
chmod +x "$SCRIPT_DIR/manage-bot.sh"
chmod +x "$SCRIPT_DIR/run-twitter-local.sh"
echo "✅ Scripts are now executable"
echo ""

# Test Discord webhook
echo "Testing Discord webhook..."
if command -v tsx &> /dev/null; then
    tsx "$SCRIPT_DIR/discord-notify.ts" "start" "Twitter bot monitoring system is being set up on $(hostname)" || {
        echo "⚠️  Discord notification test failed (check webhook URL)"
    }
elif command -v npx &> /dev/null; then
    cd "$PROJECT_DIR" && npx tsx "$SCRIPT_DIR/discord-notify.ts" "start" "Twitter bot monitoring system is being set up on $(hostname)" || {
        echo "⚠️  Discord notification test failed (check webhook URL)"
    }
else
    echo "⚠️  tsx/npx not found. Discord notifications require: npm install -g tsx"
fi
echo ""

# Check for required dependencies
echo "Checking dependencies..."
missing_deps=()

if ! command -v tsx &> /dev/null && ! command -v npx &> /dev/null; then
    missing_deps+=("tsx (npm install -g tsx)")
fi

if ! command -v python3 &> /dev/null; then
    missing_deps+=("python3")
fi

if [ ${#missing_deps[@]} -gt 0 ]; then
    echo "❌ Missing dependencies:"
    for dep in "${missing_deps[@]}"; do
        echo "  - $dep"
    done
    echo ""
    echo "Please install missing dependencies and run setup again."
    exit 1
fi

echo "✅ All dependencies found"
echo ""

# Setup cron job
echo "Setting up cron job for health checks..."
CRON_JOB="*/15 * * * * cd $PROJECT_DIR && ./scripts/health-check.sh >> /tmp/twitter-health-check.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "health-check.sh"; then
    echo "ℹ️  Cron job already exists"
else
    # Add cron job
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✅ Cron job added (runs every 15 minutes)"
fi
echo ""

# Create state files
touch /tmp/twitter-bot-health.state
touch /tmp/twitter-bot-heartbeat
touch /tmp/twitter-bot-restarts

echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the watchdog (recommended):"
echo "   ./scripts/watchdog.sh start"
echo ""
echo "2. Or start the old way (less reliable):"
echo "   ./scripts/manage-bot.sh start"
echo ""
echo "3. Check status anytime:"
echo "   ./scripts/watchdog.sh status"
echo "   ./scripts/health-check.sh"
echo ""
echo "4. View logs:"
echo "   ./scripts/watchdog.sh logs"
echo "   tail -f /tmp/twitter-bot-loop.log"
echo ""
echo "5. Health check runs automatically every 15 minutes via cron"
echo "   and will auto-restart the bot if it dies."
echo ""
echo "Discord notifications will be sent to:"
echo "   - Bot starts/stops"
echo "   - Bot crashes or gets stuck"
echo "   - Health check failures"
echo ""
