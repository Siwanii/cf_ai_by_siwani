# AI Chat Assistant Project

**AI Chat Assistant** - A production-ready AI chat application built on Cloudflare's platform .


## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Cloudflare    │    │   Cloudflare     │    │   Cloudflare    │
│     Pages       │◄──►│     Workers      │◄──►│  Workers AI     │
│  (Frontend UI)  │    │   (Backend API)  │    │   (Llama 3.3)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Durable        │
                       │   Objects        │
                       │ (Memory/State)   │
                       └──────────────────┘
```

## Features

- 🤖 **AI Responses**: Uses Llama 3.3 for intelligent conversation
- 💬 **Real time Chat**: WebSocket-based real-time communication
- 🎯 **Session Management**: Individual chat sessions with persistent state
- 🌐 **Global Edge**: Deployed on Cloudflare's global network
- ⚡ **Low Latency**: Fast responses with edge computing

## Components

### 1. Frontend (Cloudflare Pages)
- Modern React-based chat interface
- Real-time message updates
- Voice input support (Web Speech API)
- Responsive design

### 2. Backend (Cloudflare Workers)
- RESTful API endpoints
- WebSocket handling for real-time chat
- Integration with Workers AI
- Session management

### 3. AI Integration (Workers AI)
- Llama 3.3 model for text generation
- Context-aware responses
- Conversation history processing

### 4. State Management (Durable Objects)
- Persistent conversation storage
- Session state management
- Real-time coordination between clients

## 🚀 Quick Start - Running Instructions

### Prerequisites
- Node.js 18+ (will be installed automatically)
- Cloudflare account with Workers AI enabled

### Option 1: Local Development (Recommended for Testing)

```bash
# 1. Load Node.js environment
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 2. Run the application locally
./run-local.sh
```

**Access the application at:** http://localhost:3000/cf_ai_chat-assistant/

### Option 2: Cloud Deployment

```bash
# 1. Load Node.js environment
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 2. Deploy to Cloudflare
./deploy-simple.sh
```

### Option 3: Full Deployment with Durable Objects

```bash
# 1. Load Node.js environment
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 2. Deploy complete application
./deploy.sh
```

## 🧪 Testing the Application

### Test API Endpoints
```bash
# Health check
curl http://localhost:8787/api/health

# Chat API
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello! Tell me about Cloudflare Workers AI.", "sessionId": "test"}'

# Run comprehensive test suite
node test-api.js
```

### Test Frontend
1. Open http://localhost:3000/cf_ai_chat-assistant/ in your browser
2. Type a message in the chat interface
3. Use the voice input button to test speech-to-text
4. Test conversation history and context

## API Endpoints

- `POST /api/chat` - Send a message to the AI
- `GET /api/sessions/:id` - Get conversation history
- `WebSocket /ws` - Real-time chat connection

## Environment Variables

- `AI_BINDING` - Cloudflare Workers AI binding
- `CHAT_SESSION_BINDING` - Durable Object binding for chat sessions

## Development

```bash
# Start development server
npm run dev


```
