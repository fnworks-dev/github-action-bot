#!/bin/bash
#
# Twitter Bot Manager - Simple commands to control the bot
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="/tmp/twitter-bot.pid"
LOG_FILE="/tmp/twitter-bot-loop.log"

case "${1:-}" in
    start)
        if [ -f "$PID_FILE" ] && ps -p "$(cat "$PID_FILE")" > /dev/null 2>&1; then
            echo "✅ Twitter bot is already running (PID: $(cat "$PID_FILE"))"
            exit 0
        fi
        
        echo "🚀 Starting Twitter bot..."
        cd "$PROJECT_DIR" 2>/dev/null || cd "$(dirname "$SCRIPT_DIR")"
        nohup ./scripts/twitter-bot-loop.sh > /tmp/twitter-bot-nohup.log 2>&1 &
        echo $! > "$PID_FILE"
        sleep 2
        
        if ps -p "$(cat "$PID_FILE")" > /dev/null 2>&1; then
            echo "✅ Twitter bot started (PID: $(cat "$PID_FILE"))"
            echo "📊 Logs: tail -f $LOG_FILE"
        else
            echo "❌ Failed to start"
            exit 1
        fi
        ;;
    
    stop)
        if [ -f "$PID_FILE" ]; then
            pid=$(cat "$PID_FILE")
            if ps -p "$pid" > /dev/null 2>&1; then
                echo "🛑 Stopping Twitter bot (PID: $pid)..."
                kill "$pid" 2>/dev/null || true
                sleep 1
            fi
            rm -f "$PID_FILE"
        fi
        # Also kill any leftover processes
        pkill -f "twitter-bot-loop.sh" 2>/dev/null || true
        echo "✅ Twitter bot stopped"
        ;;
    
    status)
        if [ -f "$PID_FILE" ]; then
            pid=$(cat "$PID_FILE")
            if ps -p "$pid" > /dev/null 2>&1; then
                echo "✅ Twitter bot is running (PID: $pid)"
                if [ -f "$LOG_FILE" ]; then
                    echo ""
                    echo "📊 Recent activity:"
                    tail -10 "$LOG_FILE" | grep -E "(Running|completed|Started|Sleeping)"
                fi
            else
                echo "❌ Twitter bot is not running (stale PID file)"
                rm -f "$PID_FILE"
            fi
        else
            # Check if running without PID file
            pid=$(pgrep -f "twitter-bot-loop.sh" | head -1)
            if [ -n "$pid" ]; then
                echo "✅ Twitter bot is running (PID: $pid) [PID file missing]"
                echo $pid > "$PID_FILE"
            else
                echo "❌ Twitter bot is not running"
            fi
        fi
        ;;
    
    logs)
        echo "📊 Showing logs (Ctrl+C to exit)..."
        tail -f "$LOG_FILE"
        ;;
    
    run-now)
        echo "🚀 Running scraper once (manual trigger)..."
        cd "$(dirname "$SCRIPT_DIR")"
        ./scripts/run-twitter-local.sh
        ;;
    
    *)
        echo "Twitter Bot Manager"
        echo ""
        echo "Usage: $0 {start|stop|status|logs|run-now}"
        echo ""
        echo "Commands:"
        echo "  start    - Start the bot (runs every 4 hours)"
        echo "  stop     - Stop the bot"
        echo "  status   - Check if bot is running"
        echo "  logs     - View live logs"
        echo "  run-now  - Run scraper once immediately"
        echo ""
        echo "Features:"
        echo "  ✅ Runs every 4 hours automatically"
        echo "  ✅ Detects laptop sleep and runs on wake"
        echo "  ✅ Auto-starts when you login"
        echo ""
        exit 1
        ;;
esac
