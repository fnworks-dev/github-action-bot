#!/bin/bash
#
# Health Check Script for Twitter Bot
# 
# Checks if the bot is running and fetching data properly
# Should be run via cron every 15-30 minutes
#
# Usage: ./scripts/health-check.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="/tmp/twitter-bot.pid"
LOG_FILE="/tmp/twitter-bot-loop.log"
HEALTH_STATE_FILE="/tmp/twitter-bot-health.state"
DISCORD_NOTIFY="$SCRIPT_DIR/discord-notify.ts"

# Configuration
MAX_STALE_MINUTES=300  # 5 hours (bot runs every 4 hours)
MIN_LEADS_PER_RUN=5    # Minimum leads expected per successful run

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

send_discord() {
    local type="$1"
    local message="$2"
    if command -v tsx &> /dev/null; then
        tsx "$DISCORD_NOTIFY" "$type" "$message" 2>/dev/null || true
    elif command -v npx &> /dev/null; then
        cd "$PROJECT_DIR" && npx tsx "$DISCORD_NOTIFY" "$type" "$message" 2>/dev/null || true
    fi
}

get_last_run_time() {
    if [ -f "$PROJECT_DIR/.last_run" ]; then
        cat "$PROJECT_DIR/.last_run"
    else
        echo "0"
    fi
}

get_last_log_time() {
    if [ -f "$LOG_FILE" ]; then
        stat -c %Y "$LOG_FILE" 2>/dev/null || stat -f %m "$LOG_FILE" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

is_process_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    
    # Also check for the loop script
    if pgrep -f "twitter-bot-loop.sh" > /dev/null 2>&1; then
        return 0
    fi
    
    return 1
}

check_log_activity() {
    local last_log_time=$(get_last_log_time)
    local now=$(date +%s)
    local diff=$((now - last_log_time))
    local diff_min=$((diff / 60))
    
    echo "$diff_min"
}

count_recent_leads() {
    # This requires database access - we'll check if we can query it
    cd "$PROJECT_DIR"
    
    # Count leads from last 5 hours
    local result=$(node -e "
        import { createClient } from '@libsql/client';
        import { readFileSync } from 'fs';
        
        const env = readFileSync('.env', 'utf8')
            .split('\n')
            .filter(l => l.includes('=') && !l.startsWith('#'))
            .reduce((acc, l) => {
                const [k, ...v] = l.split('=');
                acc[k] = v.join('=').trim();
                return acc;
            }, {});
        
        const db = createClient({
            url: env.TURSO_DATABASE_URL,
            authToken: env.TURSO_AUTH_TOKEN
        });
        
        async function check() {
            const hoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
            const result = await db.execute(\`SELECT COUNT(*) as count FROM leads WHERE source = 'x' AND created_at > '\${hoursAgo}'\`);
            console.log(result.rows[0].count);
        }
        check().catch(() => console.log('ERROR'));
    " 2>/dev/null || echo "ERROR")
    
    echo "$result"
}

save_health_state() {
    local status="$1"
    local details="$2"
    cat > "$HEALTH_STATE_FILE" << EOF
{
    "last_check": $(date +%s),
    "status": "$status",
    "details": "$details",
    "hostname": "$(hostname)"
}
EOF
}

load_health_state() {
    if [ -f "$HEALTH_STATE_FILE" ]; then
        cat "$HEALTH_STATE_FILE"
    else
        echo '{"last_check": 0, "status": "unknown", "details": "No previous state"}'
    fi
}

# Main health check
main() {
    log "Starting health check..."
    
    local issues=()
    local restart_needed=false
    local alert_needed=false
    local alert_type=""
    local alert_message=""
    
    # Check 1: Is process running?
    if ! is_process_running; then
        issues+=("Process is NOT running")
        restart_needed=true
        alert_needed=true
        alert_type="stop"
        alert_message="Twitter bot process is dead. Last PID file: $PID_FILE"
    else
        log "${GREEN}✓ Process is running${NC}"
    fi
    
    # Check 2: Is log file being updated?
    local stale_minutes=$(check_log_activity)
    if [ "$stale_minutes" -gt "$MAX_STALE_MINUTES" ]; then
        issues+=("Log file stale for ${stale_minutes} minutes")
        restart_needed=true
        alert_needed=true
        alert_type="stale"
        alert_message="Twitter bot hasn't written to log for ${stale_minutes} minutes. Process may be stuck."
    else
        log "${GREEN}✓ Log file updated ${stale_minutes} min ago${NC}"
    fi
    
    # Check 3: Are new leads being created?
    # Only check if process is running
    if is_process_running && [ "$stale_minutes" -lt "$MAX_STALE_MINUTES" ]; then
        local recent_leads=$(count_recent_leads)
        if [ "$recent_leads" = "ERROR" ]; then
            log "${YELLOW}⚠ Could not query database${NC}"
        elif [ "$recent_leads" -lt "$MIN_LEADS_PER_RUN" ]; then
            issues+=("Only $recent_leads new leads in last 5 hours")
            alert_needed=true
            alert_type="stale"
            alert_message="Twitter bot is running but only fetched $recent_leads leads in last 5 hours. Expected at least $MIN_LEADS_PER_RUN."
        else
            log "${GREEN}✓ $recent_leads new leads in last 5 hours${NC}"
        fi
    fi
    
    # Check 4: Last run timestamp
    local last_run=$(get_last_run_time)
    local now=$(date +%s)
    local diff=$((now - last_run))
    local diff_hours=$((diff / 3600))
    
    if [ "$diff_hours" -gt 6 ]; then
        issues+=("Last successful run was $diff_hours hours ago")
        if [ "$alert_needed" = false ]; then
            alert_needed=true
            alert_type="stale"
            alert_message="Twitter bot hasn't completed a successful run in $diff_hours hours."
        fi
    else
        log "${GREEN}✓ Last run was $diff_hours hours ago${NC}"
    fi
    
    # Handle issues
    if [ ${#issues[@]} -eq 0 ]; then
        log "${GREEN}✅ All health checks passed${NC}"
        save_health_state "healthy" "All checks passed"
        exit 0
    fi
    
    # Report issues
    log "${RED}❌ Health check failed:${NC}"
    for issue in "${issues[@]}"; do
        log "  - $issue"
    done
    
    # Send Discord notification (but don't spam - check if we already sent one recently)
    local prev_state=$(load_health_state)
    local prev_alert_time=$(echo "$prev_state" | grep -o '"last_check":[0-9]*' | cut -d: -f2)
    local time_since_alert=$((now - prev_alert_time))
    
    # Only send alert every 30 minutes to avoid spam
    if [ "$alert_needed" = true ] && [ "$time_since_alert" -gt 1800 ]; then
        log "Sending Discord alert..."
        send_discord "$alert_type" "$alert_message"
        save_health_state "unhealthy" "${issues[*]}"
    else
        log "Alert already sent recently ($((time_since_alert / 60)) min ago), skipping..."
    fi
    
    # Auto-restart if needed
    if [ "$restart_needed" = true ]; then
        log "Attempting auto-restart..."
        cd "$PROJECT_DIR"
        ./scripts/manage-bot.sh stop 2>/dev/null || true
        sleep 2
        ./scripts/manage-bot.sh start
        
        sleep 5
        if is_process_running; then
            log "${GREEN}✅ Bot restarted successfully${NC}"
            send_discord "start" "Twitter bot was auto-restarted after health check failure."
        else
            log "${RED}❌ Failed to restart bot${NC}"
            send_discord "error" "Twitter bot failed to auto-restart. Manual intervention required."
        fi
    fi
    
    exit 1
}

main "$@"
