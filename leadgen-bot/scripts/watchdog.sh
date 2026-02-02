#!/bin/bash
#
# Twitter Bot Watchdog - Keeps the bot running and monitors health
#
# This is a more robust alternative to the simple loop script.
# Features:
# - Automatic restart on crash
# - Discord notifications on start/stop/error
# - Signal handling for clean shutdown
# - Heartbeat tracking
#
# Usage: ./scripts/watchdog.sh [start|stop|status]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="/tmp/twitter-bot-watchdog.pid"
BOT_PID_FILE="/tmp/twitter-bot.pid"
LOG_FILE="/tmp/twitter-bot-watchdog.log"
HEARTBEAT_FILE="/tmp/twitter-bot-heartbeat"
DISCORD_NOTIFY="$SCRIPT_DIR/discord-notify.ts"

# Configuration
RESTART_DELAY=10          # Seconds to wait before restart
MAX_RESTARTS=5            # Max restarts within window
RESTART_WINDOW=3600       # 1 hour window for max restarts
HEARTBEAT_INTERVAL=300    # Write heartbeat every 5 minutes

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" | tee -a "$LOG_FILE"
}

send_discord() {
    local type="$1"
    local message="$2"
    
    if [ -f "$DISCORD_NOTIFY" ]; then
        if command -v tsx &> /dev/null; then
            tsx "$DISCORD_NOTIFY" "$type" "$message" 2>/dev/null || true
        elif command -v npx &> /dev/null; then
            cd "$PROJECT_DIR" && npx tsx "$DISCORD_NOTIFY" "$type" "$message" 2>/dev/null || true
        fi
    fi
}

update_heartbeat() {
    date +%s > "$HEARTBEAT_FILE"
}

check_heartbeat() {
    if [ -f "$HEARTBEAT_FILE" ]; then
        local last=$(cat "$HEARTBEAT_FILE")
        local now=$(date +%s)
        echo $((now - last))
    else
        echo "99999"
    fi
}

run_bot() {
    local run_start=$(date +%s)
    
    log "${BLUE}🚀 Starting Twitter bot run...${NC}"
    
    cd "$PROJECT_DIR"
    
    # Run the bot and capture exit code
    set +e
    npm start >> "$LOG_FILE" 2>&1
    local exit_code=$?
    set -e
    
    local run_end=$(date +%s)
    local run_duration=$((run_end - run_start))
    
    if [ $exit_code -eq 0 ]; then
        log "${GREEN}✅ Bot run completed successfully (${run_duration}s)${NC}"
        update_heartbeat
        return 0
    else
        log "${RED}❌ Bot run failed with exit code $exit_code (${run_duration}s)${NC}"
        return 1
    fi
}

# Track restart attempts
record_restart() {
    local restarts_file="/tmp/twitter-bot-restarts"
    local now=$(date +%s)
    
    # Read existing restarts, filter old ones
    local restarts=()
    if [ -f "$restarts_file" ]; then
        while IFS= read -r line; do
            if [ $((now - line)) -lt $RESTART_WINDOW ]; then
                restarts+=($line)
            fi
        done < "$restarts_file"
    fi
    
    # Add current restart
    restarts+=($now)
    
    # Save back
    printf '%s\n' "${restarts[@]}" > "$restarts_file"
    
    echo ${#restarts[@]}
}

get_restart_count() {
    local restarts_file="/tmp/twitter-bot-restarts"
    local now=$(date +%s)
    local count=0
    
    if [ -f "$restarts_file" ]; then
        while IFS= read -r line; do
            if [ $((now - line)) -lt $RESTART_WINDOW ]; then
                ((count++))
            fi
        done < "$restarts_file"
    fi
    
    echo $count
}

# Main watchdog loop
watchdog_loop() {
    log "========================================"
    log "Twitter Bot Watchdog Started"
    log "Project: $PROJECT_DIR"
    log "PID: $$"
    log "========================================"
    
    send_discord "start" "Twitter bot watchdog started on $(hostname). Will run every 4 hours."
    
    # Initial run
    run_bot || true
    
    local cycle=0
    
    while true; do
        ((cycle++))
        log "${BLUE}💤 Watchdog cycle $cycle: Sleeping for 4 hours...${NC}"
        
        # Sleep in chunks to handle signals and write heartbeats
        local slept=0
        local sleep_chunk=60  # 1 minute chunks
        local total_sleep=14400  # 4 hours = 14400 seconds
        
        while [ $slept -lt $total_sleep ]; do
            sleep $sleep_chunk
            slept=$((slept + sleep_chunk))
            
            # Update heartbeat every 5 minutes
            if [ $((slept % HEARTBEAT_INTERVAL)) -lt $sleep_chunk ]; then
                update_heartbeat
            fi
        done
        
        # Check if we've exceeded max restarts
        local restart_count=$(get_restart_count)
        if [ $restart_count -ge $MAX_RESTARTS ]; then
            log "${RED}🛑 Too many restarts ($restart_count in last hour). Stopping watchdog.${NC}"
            send_discord "error" "Watchdog stopping: Too many failed attempts ($restart_count in last hour). Manual intervention required."
            exit 1
        fi
        
        # Run the bot
        if ! run_bot; then
            record_restart
            local new_count=$(get_restart_count)
            log "${YELLOW}⚠️ Run failed. Restart count: $new_count/$MAX_RESTARTS${NC}"
            
            if [ $new_count -ge 3 ]; then
                send_discord "error" "Bot has failed $new_count times in the last hour. Will keep retrying."
            fi
            
            log "Waiting ${RESTART_DELAY}s before retry..."
            sleep $RESTART_DELAY
        fi
    done
}

# Signal handlers
cleanup() {
    log "${YELLOW}🛑 Watchdog received shutdown signal${NC}"
    send_discord "stop" "Twitter bot watchdog is shutting down on $(hostname)."
    
    # Kill child process if exists
    if [ -f "$BOT_PID_FILE" ]; then
        local pid=$(cat "$BOT_PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            log "Stopping bot process $pid..."
            kill "$pid" 2>/dev/null || true
            sleep 2
        fi
    fi
    
    rm -f "$PID_FILE"
    exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP

# Commands
case "${1:-}" in
    start)
        if [ -f "$PID_FILE" ]; then
            local old_pid=$(cat "$PID_FILE")
            if ps -p "$old_pid" > /dev/null 2>&1; then
                log "${GREEN}Watchdog already running (PID: $old_pid)${NC}"
                exit 0
            fi
            rm -f "$PID_FILE"
        fi
        
        log "Starting watchdog in background..."
        nohup "$0" run >> "$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
        sleep 2
        
        if ps -p $(cat "$PID_FILE") > /dev/null 2>&1; then
            log "${GREEN}✅ Watchdog started (PID: $(cat "$PID_FILE"))${NC}"
            log "Logs: tail -f $LOG_FILE"
        else
            log "${RED}❌ Failed to start watchdog${NC}"
            exit 1
        fi
        ;;
    
    stop)
        if [ -f "$PID_FILE" ]; then
            local pid=$(cat "$PID_FILE")
            if ps -p "$pid" > /dev/null 2>&1; then
                log "Stopping watchdog (PID: $pid)..."
                kill "$pid" 2>/dev/null || true
                sleep 2
            fi
            rm -f "$PID_FILE"
        fi
        
        # Also stop any bot processes
        pkill -f "twitter-bot-loop.sh" 2>/dev/null || true
        pkill -f "twitter_fetcher.py" 2>/dev/null || true
        
        log "${GREEN}✅ Watchdog stopped${NC}"
        ;;
    
    status)
        if [ -f "$PID_FILE" ]; then
            local pid=$(cat "$PID_FILE")
            if ps -p "$pid" > /dev/null 2>&1; then
                local heartbeat_age=$(check_heartbeat)
                local heartbeat_min=$((heartbeat_age / 60))
                
                echo -e "${GREEN}✅ Watchdog is running (PID: $pid)${NC}"
                echo "  Log file: $LOG_FILE"
                echo "  Heartbeat: $heartbeat_min min ago"
                
                if [ $heartbeat_age -gt 1800 ]; then
                    echo -e "${YELLOW}  ⚠️ Heartbeat is stale (>30 min)${NC}"
                fi
                
                echo ""
                echo "Recent activity:"
                tail -5 "$LOG_FILE" | grep -E "(Starting|completed|failed|cycle)" || true
            else
                echo -e "${RED}❌ Watchdog is not running (stale PID file)${NC}"
                rm -f "$PID_FILE"
            fi
        else
            echo -e "${RED}❌ Watchdog is not running${NC}"
        fi
        ;;
    
    logs)
        tail -f "$LOG_FILE"
        ;;
    
    run)
        # Internal command - run the loop directly
        watchdog_loop
        ;;
    
    *)
        echo "Twitter Bot Watchdog"
        echo ""
        echo "Usage: $0 {start|stop|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the watchdog (runs bot every 4 hours)"
        echo "  stop    - Stop the watchdog"
        echo "  status  - Check watchdog status"
        echo "  logs    - View live logs"
        echo ""
        echo "Features:"
        echo "  ✅ Auto-restart on crash (max 5/hour)"
        echo "  ✅ Discord notifications on events"
        echo "  ✅ Heartbeat tracking"
        echo "  ✅ Clean signal handling"
        exit 1
        ;;
esac
