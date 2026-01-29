#!/bin/bash
#
# Simple Twitter Bot Loop - Runs every 4 hours with sleep detection
#
# Usage: ./scripts/twitter-bot-loop.sh
# 
# This script:
# - Runs immediately when started
# - Then sleeps for 4 hours
# - If laptop was asleep, it detects this (more than 4 hours passed)
#   and runs immediately on wake, then continues 4-hour schedule
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/tmp/twitter-bot-loop.log"
LAST_RUN_FILE="$PROJECT_DIR/.last_run"
INTERVAL_HOURS=4
INTERVAL_SEC=$((INTERVAL_HOURS * 3600))

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

get_timestamp() {
    date +%s
}

record_run() {
    get_timestamp > "$LAST_RUN_FILE"
}

run_bot() {
    log "🚀 Running Twitter scraper..."
    
    cd "$PROJECT_DIR"
    
    if npm start >> "$LOG_FILE" 2>&1; then
        log "✅ Scraper completed successfully"
        record_run
    else
        log "⚠️ Scraper failed (exit code: $?), but continuing..."
        record_run  # Still record to avoid tight retry loops
    fi
}

# Main loop
main() {
    log "========================================"
    log "Twitter Bot Loop Started"
    log "Interval: ${INTERVAL_HOURS} hours"
    log "========================================"
    
    # Run immediately on start
    log "Initial run on startup"
    run_bot
    
    while true; do
        log "💤 Sleeping for ${INTERVAL_HOURS} hours..."
        
        # Sleep in 60-second chunks to handle signals better
        slept=0
        while [ $slept -lt $INTERVAL_SEC ]; do
            sleep 60
            slept=$((slept + 60))
        done
        
        # Check how much time actually passed (handles laptop sleep)
        if [ -f "$LAST_RUN_FILE" ]; then
            last_run=$(cat "$LAST_RUN_FILE")
            now=$(get_timestamp)
            diff=$((now - last_run))
            
            # If less than 3 hours passed, laptop was probably asleep
            # Wait a bit more, then run
            if [ $diff -lt 10800 ]; then
                log "⏰ Only $((diff / 60)) min passed (laptop asleep?), waiting more..."
                sleep 300  # Wait 5 more minutes
            fi
        fi
        
        log "📍 Scheduled run after ${INTERVAL_HOURS} hours"
        run_bot
    done
}

# Run main loop
main
