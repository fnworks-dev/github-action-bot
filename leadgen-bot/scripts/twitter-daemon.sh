#!/bin/bash
#
# Twitter Bot Daemon - Robust local scheduler with sleep detection
#
# Features:
# - Runs immediately on start
# - Runs every 4 hours when laptop is on
# - Skips missed runs during sleep
# - Runs immediately on wake if >4 hours since last run
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RUN_INTERVAL_HOURS=4
RUN_INTERVAL_SECONDS=$((RUN_INTERVAL_HOURS * 3600))
LOCK_FILE="/tmp/twitter-daemon.lock"
LOG_FILE="/tmp/twitter-daemon.log"
LAST_RUN_FILE="$PROJECT_DIR/.last_run"

# Logging function
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Get current timestamp
get_timestamp() {
    date +%s
}

# Check if we should run (4+ hours since last run)
should_run() {
    if [ ! -f "$LAST_RUN_FILE" ]; then
        return 0  # Never ran before, should run
    fi
    
    local last_run=$(cat "$LAST_RUN_FILE")
    local current=$(get_timestamp)
    local diff=$((current - last_run))
    
    if [ $diff -ge $RUN_INTERVAL_SECONDS ]; then
        return 0  # 4+ hours passed, should run
    else
        return 1  # Less than 4 hours, skip
    fi
}

# Record last run time
record_run() {
    get_timestamp > "$LAST_RUN_FILE"
}

# Run the bot
run_bot() {
    log "${BLUE}🚀 Starting Twitter scraper...${NC}"
    
    cd "$PROJECT_DIR"
    
    # Run the bot and capture output
    if npm start >> "$LOG_FILE" 2>&1; then
        log "${GREEN}✅ Twitter scraper completed successfully${NC}"
        record_run
        return 0
    else
        log "${YELLOW}⚠️ Twitter scraper failed (exit code: $?)${NC}"
        # Still record run to avoid tight retry loops
        record_run
        return 1
    fi
}

# Check if daemon is already running
check_running() {
    if [ -f "$LOCK_FILE" ]; then
        local pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if ps -p "$pid" > /dev/null 2>&1; then
            log "${YELLOW}⚠️ Daemon already running (PID: $pid)${NC}"
            exit 1
        else
            # Stale lock file
            rm -f "$LOCK_FILE"
        fi
    fi
}

# Cleanup on exit
cleanup() {
    rm -f "$LOCK_FILE"
    log "${YELLOW}🛑 Daemon stopped${NC}"
    exit 0
}

# Set trap for clean exit
trap cleanup EXIT INT TERM

# Main daemon loop
main() {
    check_running
    
    # Write PID to lock file
    echo $$ > "$LOCK_FILE"
    
    log "${GREEN}========================================${NC}"
    log "${GREEN}  Twitter Bot Daemon Started${NC}"
    log "${GREEN}  Interval: ${RUN_INTERVAL_HOURS} hours${NC}"
    log "${GREEN}========================================${NC}"
    
    # Run immediately on first start
    log "${BLUE}📍 Initial run on daemon start${NC}"
    run_bot
    
    # Main loop
    while true; do
        # Sleep in small increments to handle signals better
        local sleep_count=0
        local sleep_chunk=60  # Check every minute
        local total_sleep=$RUN_INTERVAL_SECONDS
        
        log "${BLUE}💤 Sleeping for ${RUN_INTERVAL_HOURS} hours...${NC}"
        
        while [ $sleep_count -lt $total_sleep ]; do
            sleep $sleep_chunk
            sleep_count=$((sleep_count + sleep_chunk))
            
            # Check if we should exit
            if [ ! -f "$LOCK_FILE" ]; then
                log "${YELLOW}🛑 Lock file removed, stopping daemon${NC}"
                exit 0
            fi
        done
        
        # Check if we should run (handles laptop sleep)
        if should_run; then
            log "${BLUE}📍 Scheduled run (4+ hours since last run)${NC}"
            run_bot
        else
            # This shouldn't happen normally, but handles edge cases
            log "${YELLOW}⏭️ Skipping run (less than 4 hours - was laptop asleep?)${NC}"
            record_run  # Reset the timer
        fi
    done
}

# Handle commands
case "${1:-}" in
    start)
        # Check if already running
        if [ -f "$LOCK_FILE" ]; then
            pid=$(cat "$LOCK_FILE" 2>/dev/null)
            if ps -p "$pid" > /dev/null 2>&1; then
                log "${YELLOW}Daemon already running (PID: $pid)${NC}"
                exit 0
            fi
        fi
        
        # Start daemon in detached mode using nohup
        nohup "$0" daemon > /dev/null 2>&1 &
        sleep 1
        
        # Check if started
        if [ -f "$LOCK_FILE" ]; then
            new_pid=$(cat "$LOCK_FILE" 2>/dev/null)
            if ps -p "$new_pid" > /dev/null 2>&1; then
                log "${GREEN}Daemon started (PID: $new_pid)${NC}"
                log "${BLUE}Logs: tail -f $LOG_FILE${NC}"
            else
                log "${RED}Failed to start daemon${NC}"
                exit 1
            fi
        fi
        ;;
    daemon)
        # Internal command - run the main loop
        main
        ;;
    stop)
        if [ -f "$LOCK_FILE" ]; then
            pid=$(cat "$LOCK_FILE" 2>/dev/null)
            kill "$pid" 2>/dev/null || true
            rm -f "$LOCK_FILE"
            log "${GREEN}Daemon stopped${NC}"
        else
            log "${YELLOW}Daemon not running${NC}"
        fi
        ;;
    status)
        if [ -f "$LOCK_FILE" ]; then
            pid=$(cat "$LOCK_FILE" 2>/dev/null)
            if ps -p "$pid" > /dev/null 2>&1; then
                log "${GREEN}Daemon is running (PID: $pid)${NC}"
                if [ -f "$LAST_RUN_FILE" ]; then
                    last_run=$(cat "$LAST_RUN_FILE")
                    last_run_human=$(date -d "@$last_run" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "$last_run" '+%Y-%m-%d %H:%M:%S')
                    log "Last run: $last_run_human"
                fi
            else
                log "${YELLOW}Stale lock file found, daemon not running${NC}"
                rm -f "$LOCK_FILE"
            fi
        else
            log "${YELLOW}Daemon not running${NC}"
        fi
        ;;
    run-now)
        # Run once immediately (for manual trigger)
        log "${BLUE}Manual run triggered${NC}"
        run_bot
        ;;
    logs)
        tail -f "$LOG_FILE"
        ;;
    *)
        echo "Usage: $0 {start|stop|status|run-now|logs}"
        echo ""
        echo "Commands:"
        echo "  start    - Start the daemon in background"
        echo "  stop     - Stop the daemon"
        echo "  status   - Check daemon status"
        echo "  run-now  - Run bot immediately (one-time)"
        echo "  logs     - View live logs"
        echo ""
        echo "The daemon:"
        echo "  - Runs immediately when started"
        echo "  - Runs every 4 hours when laptop is on"
        echo "  - Skips missed runs during sleep"
        echo "  - Resumes schedule on wake"
        exit 1
        ;;
esac
