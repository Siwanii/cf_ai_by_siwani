#!/bin/bash

# Don't exit on error - allow background processes to continue
set +e

API_PORT=${API_PORT:-8787}
FRONTEND_PORT=${FRONTEND_PORT:-3000}
OPEN_BROWSER=${OPEN_BROWSER:-1}
FRONTEND_PATH=${FRONTEND_PATH:-/cf_ai_chat-assistant/}

echo "🚀 Starting AI Chat Assistant locally..."
echo ""

# Load Node.js environment
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not available. Please install Node.js (nvm or nodejs.org)."
    exit 1
fi

# Ensure Python3 for static server
if ! command -v python3 &> /dev/null; then
    echo "❌ python3 is required to serve the static page. Please install Python 3."
    exit 1
fi

# Kill anything on the default ports to avoid conflicts
lsof -ti:${API_PORT} | xargs kill -9 2>/dev/null || true
lsof -ti:${FRONTEND_PORT} | xargs kill -9 2>/dev/null || true

# Start the Worker in development mode using main wrangler.toml
# Note: Using remote mode (without --local) to enable Vectorize bindings
echo "🔧 Starting Cloudflare Worker on http://localhost:${API_PORT}"
echo "⚠️  Note: Using REMOTE mode for Vectorize support. Vectorize requires remote connection."
echo "⚠️  Vectorize bindings only work in remote mode, not local mode."
echo ""

# Create a log file for wrangler output
WRANGLER_LOG="/tmp/wrangler-dev-${API_PORT}.log"
rm -f "$WRANGLER_LOG"

# Start wrangler in background and capture PID
(
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  
  # Run wrangler dev and log output
  wrangler dev --remote --port ${API_PORT} 2>&1 | tee "$WRANGLER_LOG" | sed -e "s#http://localhost:${API_PORT}#\x1b[34mhttp://localhost:${API_PORT}\x1b[0m#g"
) &
WRANGLER_PID=$!

# Give wrangler a moment to start
sleep 2

# Check if process is still running
if ! kill -0 $WRANGLER_PID 2>/dev/null; then
  echo "❌ Wrangler dev failed to start"
  if [ -f "$WRANGLER_LOG" ]; then
    echo "📋 Last few lines of wrangler log:"
    tail -20 "$WRANGLER_LOG" 2>/dev/null || true
  fi
  echo ""
  echo "💡 Common issues:"
  echo "   - Not logged in: Run 'wrangler login'"
  echo "   - Network issues: Check your internet connection"
  echo "   - Port in use: Another process is using port ${API_PORT}"
  echo "   - Syntax errors: Check your code for errors"
  exit 1
fi

echo "✅ Wrangler dev started (PID: $WRANGLER_PID)"

# Start a simple static server to host content (disown to avoid being killed)
(
  sleep 1
  echo "🌐 Serving static content on http://localhost:${FRONTEND_PORT}${FRONTEND_PATH}"
  nohup python3 -m http.server ${FRONTEND_PORT} --directory "$(pwd)" >/dev/null 2>&1 & disown
) &

# Print clickable URLs
sleep 2
echo ""
echo "🔗 URLs"
echo "- API:        http://localhost:${API_PORT}/api/health"
list_path="${FRONTEND_PATH%/}/index.html"
echo "- Chat API:   http://localhost:${API_PORT}/api/chat"
echo "- Frontend:   http://localhost:${FRONTEND_PORT}${FRONTEND_PATH}"
echo "  (index):    http://localhost:${FRONTEND_PORT}${list_path}"
echo ""

# Optionally open browser
if [ "${OPEN_BROWSER}" = "1" ]; then
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:${FRONTEND_PORT}${FRONTEND_PATH}"
  fi
fi

# Wait a moment to ensure processes started
sleep 3

# Check if wrangler is still running
if ! kill -0 $WRANGLER_PID 2>/dev/null; then
  echo "❌ Wrangler dev process exited unexpectedly"
  if [ -f "$WRANGLER_LOG" ]; then
    echo "📋 Wrangler error log:"
    tail -30 "$WRANGLER_LOG" 2>/dev/null || true
  fi
  echo ""
  echo "💡 Check the logs above for errors"
  exit 1
fi

echo "✅ Server is running!"
echo "📝 Press Ctrl+C to stop the server"
echo "📋 Wrangler logs: tail -f $WRANGLER_LOG"
echo ""

# Keep script running to preserve background jobs
# Trap SIGINT to clean up on Ctrl+C
trap 'echo ""; echo "🛑 Stopping servers..."; kill $WRANGLER_PID 2>/dev/null || true; lsof -ti:${API_PORT} | xargs kill -9 2>/dev/null || true; lsof -ti:${FRONTEND_PORT} | xargs kill -9 2>/dev/null || true; rm -f "$WRANGLER_LOG" 2>/dev/null; exit 0' INT TERM

# Wait for background processes
wait
