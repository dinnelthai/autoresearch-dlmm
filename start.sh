#!/usr/bin/env bash
# One foreground launcher; existing services and local configs remain unchanged.
set -eu
cd "$(dirname "$0")"
umask 077
NODE_BIN="${NODE_BIN:-node}"
LIVE_CONFIG="${LIVE_CONFIG:-data/live-config-basket.json}"
TERMINAL_CONFIG="${TERMINAL_CONFIG:-data/terminal-config-basket.json}"
LIVE_PORT=8788
WEB_PORT=8790
command -v "$NODE_BIN" >/dev/null || { echo "Node 22 not found; set NODE_BIN to your existing runtime."; exit 1; }
command -v curl >/dev/null || { echo "curl required"; exit 1; }
for config in "$LIVE_CONFIG" "$TERMINAL_CONFIG"; do
  [ -r "$config" ] || { echo "Missing config: $config"; exit 1; }
done
port_free(){
  "$NODE_BIN" -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(Number(process.argv[1]),"127.0.0.1",()=>s.close())' "$1"
}
# Verify the listening process belongs to this checkout before sending a signal.
# macOS and Linux lsof expose the listener PID and its working directory.
stop_old(){
  local port="$1" service="$2" pid pids cmd cwd i
  if port_free "$port"; then return 0; fi
  command -v lsof >/dev/null || { echo "Port $port occupied; lsof required to identify the old service."; return 1; }
  pids=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN || true)
  [ -n "$pids" ] || { echo "Port $port occupied; listener could not be identified."; return 1; }
  for pid in $pids; do
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
    case "$cmd" in
      *"research/live/$service "*) ;;
      *) echo "Port $port belongs to another program (PID $pid); not stopping it."; return 1 ;;
    esac
    if [ "$cwd" != "$(pwd -P)" ]; then
      echo "Port $port listener is outside this checkout (PID $pid); not stopping it."
      return 1
    fi
  done
  for pid in $pids; do
    echo "Stopping old $service (PID $pid, port $port)..."
    kill -TERM "$pid" 2>/dev/null || true
  done
  # Graceful shutdown lets the collector release its lock and both services finish writes.
  for ((i=0;i<60;i++)); do
    local alive=0
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then alive=1; fi
    done
    if [ "$alive" -eq 0 ] && port_free "$port"; then return 0; fi
    sleep 1
  done
  echo "Old $service did not stop cleanly on port $port. Inspect its logs; not forcing a kill."
  return 1
}
# Stop the old Web reader/writer before stopping its collector.
stop_old "$WEB_PORT" terminal-server.mjs
stop_old "$LIVE_PORT" state-service.mjs
mkdir -p data/run-logs
LOG_DIR=$(mktemp -d "data/run-logs/run-$(date +%Y%m%d-%H%M%S)-XXXXXX")
collector_pid=""
web_pid=""
cleanup(){
  trap - EXIT INT TERM
  for pid in "$web_pid" "$collector_pid"; do
    if [ -n "$pid" ]; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
  for pid in "$web_pid" "$collector_pid"; do
    if [ -n "$pid" ]; then wait "$pid" 2>/dev/null || true; fi
  done
  echo "Services stopped. Logs: $LOG_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ready(){
  local pid="$1" port="$2" log="$3" i
  for ((i=0;i<60;i++)); do
    kill -0 "$pid" 2>/dev/null || { echo "Service exited; see $log"; return 1; }
    if curl -fsS --max-time 1 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Health endpoint not ready: $port; see $log"
  return 1
}
"$NODE_BIN" research/live/state-service.mjs --config "$LIVE_CONFIG" --port "$LIVE_PORT" >"$LOG_DIR/collector.log" 2>&1 &
collector_pid=$!
ready "$collector_pid" "$LIVE_PORT" "$LOG_DIR/collector.log"
"$NODE_BIN" research/live/terminal-server.mjs --config "$TERMINAL_CONFIG" --port "$WEB_PORT" >"$LOG_DIR/terminal.log" 2>&1 &
web_pid=$!
ready "$web_pid" "$WEB_PORT" "$LOG_DIR/terminal.log"
echo "Terminal: http://127.0.0.1:$WEB_PORT"
echo "Logs: $LOG_DIR/{collector,terminal}.log"
echo "HTTP services ready; market data may still be collecting. Ctrl+C stops both."
while kill -0 "$collector_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do sleep 2; done
echo "A service exited. Inspect the logs above."
exit 1
