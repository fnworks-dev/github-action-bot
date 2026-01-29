#!/bin/bash
# Simple wrapper to start daemon with nohup

cd "/home/fajar/Coding Works/FNWORK/Portofix/fnwork dev/github-action-bot/leadgen-bot"
nohup ./scripts/twitter-daemon.sh run-now > /tmp/twitter-daemon-nohup.log 2>&1 &
echo $! > /tmp/twitter-daemon.pid
echo "Daemon started with PID: $!"
echo "Logs: tail -f /tmp/twitter-daemon.log"
