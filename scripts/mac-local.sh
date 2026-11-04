#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${OMB_DATA_DIR:-$HOME/.openmausbot}"
LOG_DIR="$DATA_DIR/logs"
OUT_LOG="$LOG_DIR/bigman-web.out.log"
ERR_LOG="$LOG_DIR/bigman-web.err.log"
PORT="${OMB_PORT:-8799}"
WEBHOOK_PORT="${OMB_WEBHOOK_PORT:-8800}"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.bigmanbot.web.plist"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/share/fnm:$HOME/.nvm/Current/bin:$PATH"
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env 2>/dev/null || true)"
fi

mkdir -p "$LOG_DIR"

server_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

health_ok() {
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1
}

ensure_built() {
  cd "$ROOT_DIR"
  if [ ! -d "node_modules" ]; then
    pnpm install
  fi
  if [ ! -f "dist/index.html" ] || [ ! -f "dist-server/openmausbot.js" ]; then
    pnpm build
    pnpm build:server
  fi
}

open_pair_link() {
  cd "$ROOT_DIR"
  local output code
  output="$(node dist-server/openmausbot.js pair --port "$PORT" --label "Mac" 2>&1 || true)"
  echo "$output"
  code="$(printf '%s\n' "$output" | sed -n 's/.*#code=\([A-Za-z0-9_-]*\).*/\1/p' | head -n 1 || true)"
  if [ -n "$code" ]; then
    open "http://127.0.0.1:$PORT/#code=$code"
  else
    open "http://127.0.0.1:$PORT/"
  fi
}

start_server() {
  ensure_built
  if health_ok; then
    echo "Bigman Bot is already running at http://127.0.0.1:$PORT/ (PID $(server_pid))"
    if [ "${1:-}" = "--open" ]; then
      open_pair_link
    fi
    return 0
  fi

  cd "$ROOT_DIR"
  OMB_DATA_DIR="$DATA_DIR" \
  OMB_STATIC_DIR="$ROOT_DIR/dist" \
  OMB_PORT="$PORT" \
  OMB_WEBHOOK_PORT="$WEBHOOK_PORT" \
  NODE_ENV=production \
  nohup node "$ROOT_DIR/dist-server/openmausbot.js" serve >>"$OUT_LOG" 2>>"$ERR_LOG" </dev/null &

  for _ in $(seq 1 40); do
    if health_ok; then
      echo "Bigman Bot started at http://127.0.0.1:$PORT/ (PID $(server_pid))"
      if [ "${1:-}" = "--open" ]; then
        open_pair_link
      fi
      return 0
    fi
    sleep 0.5
  done

  echo "Bigman Bot did not become healthy in time. Check $ERR_LOG" >&2
  exit 1
}

stop_server() {
  local pid
  pid="$(server_pid)"
  if [ -z "$pid" ]; then
    echo "Bigman Bot is not running."
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    if [ -z "$(server_pid)" ]; then
      echo "Bigman Bot stopped."
      return 0
    fi
    sleep 0.3
  done
  kill -9 "$pid" 2>/dev/null || true
  echo "Bigman Bot force-stopped."
}

case "${1:-start}" in
  setup)
    cd "$ROOT_DIR"
    pnpm install
    pnpm build
    pnpm build:server
    node dist-server/openmausbot.js browser install || true
    echo "Setup complete."
    ;;
  start)
    start_server "--open"
    ;;
  start-headless)
    start_server ""
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server
    start_server "${2:---open}"
    ;;
  pair)
    ensure_built
    open_pair_link
    ;;
  status)
    if health_ok; then
      echo "Status: RUNNING (PID $(server_pid)) at http://127.0.0.1:$PORT/"
    else
      echo "Status: STOPPED"
    fi
    ;;
  autostart-on)
    ensure_built
    mkdir -p "$(dirname "$LAUNCH_AGENT")"
    cat >"$LAUNCH_AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.bigmanbot.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT_DIR/scripts/mac-local.sh</string>
    <string>start-headless</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
</dict>
</plist>
EOF
    launchctl unload "$LAUNCH_AGENT" >/dev/null 2>&1 || true
    launchctl load "$LAUNCH_AGENT"
    echo "Auto-start on macOS login enabled ($LAUNCH_AGENT)."
    ;;
  autostart-off)
    launchctl unload "$LAUNCH_AGENT" >/dev/null 2>&1 || true
    rm -f "$LAUNCH_AGENT"
    echo "Auto-start on macOS login disabled."
    ;;
  *)
    echo "Usage: $0 {setup|start|stop|restart|pair|status|autostart-on|autostart-off}" >&2
    exit 1
    ;;
esac
