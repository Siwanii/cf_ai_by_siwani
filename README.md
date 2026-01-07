# AgentFlow AI Assistant

A smart AI chat assistant built on Cloudflare Workers that can help with programming, answer questions, and even read your documents. Think of it as ChatGPT, but running on Cloudflare's edge network for super fast responses.

## Introduction

This is an AI-powered chat assistant that combines the power of Llama 3.3 with some clever features. It can autonomously decide when to search the web, check the weather, or do calculations. Plus, you can upload PDFs, images, or text files and ask questions about them - the AI will actually read and understand your documents.

The cool part? It runs entirely on Cloudflare Workers, so it's fast, scalable, and doesn't require managing any servers. Everything happens at the edge.

## Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Cloudflare     │    │   Cloudflare    │
│   (HTML/JS)     │◄──►│     Workers      │◄──►│  Workers AI     │
│   Chat UI       │    │   (Backend API)  │    │   (Llama 3.3)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌──────────────┐    ┌──────────────┐
            │   Durable   │    │  Vectorize   │
            │   Objects   │    │   (RAG)      │
            │  (Sessions) │    │ (Embeddings) │
            └──────────────┘    └──────────────┘
```

The frontend is a simple HTML page that talks to a Cloudflare Worker. The Worker handles all the AI logic, manages chat sessions using Durable Objects, and stores document embeddings in Vectorize for the RAG functionality.

## How It Works (Mechanism)

### Function Calling (Tool Use)

When you ask a question, the AI doesn't just rely on its training data. It can actually use tools:

1. **You ask a question** - Like "What's the weather in San Francisco?" or "Who is the president in 2026?"
2. **AI decides** - The system detects that this needs current information and automatically triggers the `search_web` tool
3. **Tool executes** - It searches DuckDuckGo and Wikipedia for up-to-date information
4. **AI responds** - The AI uses the search results to give you an accurate, current answer

The AI has access to several tools:
- `search_web` - For current events, news, and 2025/2026 information
- `get_weather` - Current weather for any location
- `calculate` - Math calculations
- `get_current_time` - Current date and time
- `convert_currency` - Currency conversion

### RAG (Retrieval-Augmented Generation)

The document reading feature works like this:

1. **You upload a file** - PDF, text file, image, or paste a URL
2. **Processing happens**:
   - For PDFs/text: Extracts text, splits it into chunks, creates embeddings
   - For images: Uses vision models to generate a detailed description
3. **Storage** - Everything gets stored in Vectorize (Cloudflare's vector database)
4. **When you ask questions** - The system finds relevant chunks from your document and includes them in the AI's context
5. **AI responds** - Using the actual content from your document

The system is smart about handling images - if you upload one and immediately ask about it, it knows Vectorize might still be indexing and will retry automatically.

## Setup

### Prerequisites

You'll need:
- Node.js 18 or higher
- A Cloudflare account (free tier works fine)
- Wrangler CLI installed globally

### Installation Steps

1. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```
   This opens a browser window to authenticate.

2. **Create the Vectorize index** (for document storage):
   ```bash
   wrangler vectorize create rag-documents --dimensions=384 --metric=cosine
   ```
   
   Or just run the setup script:
   ```bash
   ./setup-vectorize.sh
   ```

3. **Install dependencies** (if needed):
   ```bash
   npm install
   ```

That's it! The setup is pretty straightforward.

## Run the AI Assistant

Once everything is set up, just run:

```bash
./run-local.sh
```

Or if you prefer npm:
```bash
npm run dev
```

The script will start the Cloudflare Worker in development mode. You'll see output showing it's connecting to Vectorize and Workers AI.

Then open your browser to:
- **Chat Interface**: http://localhost:3000/cf_ai_chat-assistant/
- **Health Check**: http://localhost:8787/api/health

**Note**: The chat interface runs on port 3000 (served by a Python HTTP server), while the API runs on port 8787 (Cloudflare Worker).

The chat interface is pretty intuitive - just type your question and hit enter. You can also:
- Click the ➕ button to upload files
- Click the 🎤 icon for voice input
- Paste URLs directly in the chat

## Architecture Details

### Core Components

**Frontend (`cf_ai_chat-assistant/index.html`)**
- Simple HTML/CSS/JavaScript chat interface
- Handles streaming responses, file uploads, voice input
- Dark mode support with localStorage persistence

**Main Worker (`src/index.js`)**
- Handles all HTTP requests
- Routes to chat, upload, and health endpoints
- Manages CORS and error handling

**Workflow Engine (`src/workflow.js`)**
- Orchestrates the AI agent logic
- Detects when tools are needed
- Manages the conversation flow
- Handles function calling and tool execution

**Function Registry (`src/functions.js`)**
- Defines available tools (search_web, get_weather, etc.)
- Implements each tool's logic
- Returns structured results for the AI

**RAG System (`src/rag.js`)**
- Handles document processing (PDF extraction, image understanding)
- Creates embeddings using BGE model
- Manages Vectorize storage and retrieval
- Handles race conditions for image indexing

**Session Management (`src/chat-session.js`)**
- Durable Object for persistent chat sessions
- Stores conversation history
- Maintains context across messages

### Technical Stack

- **AI Model**: Llama 3.3 70B (via Cloudflare Workers AI)
- **Embeddings**: BGE-small-en-v1.5 (384 dimensions)
- **Vector Database**: Cloudflare Vectorize
- **Session Storage**: Cloudflare Durable Objects
- **Vision Models**: LLaVA, UForm, Llama Vision (for images)

### How Tools Are Triggered

The system uses a combination of:
1. **Keyword detection** - Looks for words like "weather", "2025", "calculate"
2. **Auto-trigger logic** - Automatically calls tools when needed (no need for the AI to explicitly request)
3. **Context awareness** - Understands when current information is needed vs. general knowledge

For example, if you ask "Who is the president in 2026?", the system automatically:
- Detects "2026" keyword
- Triggers `search_web` with the query
- Gets current information
- AI uses that to answer accurately

### Document Processing Flow

1. **Upload** → File/URL received
2. **Extract** → Text from PDF, description from image, content from URL
3. **Chunk** → Split into ~500 character pieces with overlap
4. **Embed** → Convert to 384-dimensional vectors
5. **Store** → Save in Vectorize with metadata
6. **Query** → When you ask, find similar chunks
7. **Respond** → AI uses chunks to answer your question

The system is smart about filtering out PDF metadata and noise, so you get clean, relevant content.

---

**Built with Cloudflare Workers AI** - Fast, scalable, and serverless.
