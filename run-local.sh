#!/bin/bash

# Local Development Script for AI Chat Assistant
# Runs the application locally for testing

set -e

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

# Start the Worker in development mode using main wrangler.toml (local mode)
(
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  echo "🔧 Starting Cloudflare Worker on http://localhost:${API_PORT}"
  wrangler dev --local --port ${API_PORT} | sed -e "s#http://localhost:${API_PORT}#\x1b[34mhttp://localhost:${API_PORT}\x1b[0m#g"
) &

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

# Keep script running to preserve background jobs
wait
