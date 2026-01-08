# 🤖 AgentFlow AI Assistant

Hey there! 👋 I'm Siwani, and this is my AI assistant that I built. It's not perfect, but I'm really proud of how far it's come. 

**What it does:** Think ChatGPT, but it can actually search the web, read your documents, and make its own decisions about when to use different tools. Plus, it runs entirely on Cloudflare's edge network (which means it's fast and I don't have to manage any servers).


## 🏗️ Architecture

```
               User's Browser
                  │
                  ▼
         ┌──────────────────┐
         │   My Frontend    │  ← Simple HTML/JS 
         │    Chat UI       │
         └──────────────────┘
                  │
                  ▼
         ┌──────────────────┐
         │ Cloudflare Worker│  ← The brain! All logic lives here
         │   (Backend API)  │
         └──────────────────┘
                  │
            ┌───────┴────────┬──────────┐
            ▼                ▼          ▼
      ┌──────────┐   ┌─────────────┐  ┌──────────┐
      │Workers AI│   │  Vectorize  │  │ R2 Bucket│
      │(Llama 3.3│   │(Embeddings) │  │(Files)   │
      │& Vision) │   └─────────────┘  └──────────┘
      └──────────┘
```

The frontend is a simple HTML page that talks to a Cloudflare Worker. The Worker handles all the AI logic, manages chat sessions using Durable Objects, and stores document embeddings in Vectorize for the RAG functionality.

## 🚀 How It Works (Mechanism)

### 1. Function Calling (Tool Use)

The AI agent autonomously decides which tools to use based on your query:

```javascript
User: "What's the weather in Paris?"
  ↓
Agent: Detects need for weather data
  ↓
Agent: Calls get_weather("Paris")
  ↓
Agent: "It's currently 18°C and sunny in Paris!"
```

**Available Tools:**
- `web_search` - Search the web for current information
- `get_weather` - Get real-time weather data
- `calculate` - Perform mathematical calculations
- `get_current_time` - Get current time in any timezone
- `convert_currency` - Convert between currencies


### 2. RAG (Retrieval Augmented Generation)

Upload documents and ask questions about them:

```javascript
1. Upload PDF → Extracted & chunked → Embedded (Workers AI)
2. Embeddings stored → Vectorize database
3. User asks question → Vector search → Relevant chunks retrieved
4. AI generates answer → Using retrieved context
```

### 3. Vision Capabilities
Upload images and get AI-powered descriptions:

```javascript
Upload image → Llama 3.2 Vision → Detailed description
  ↓
Ask questions → AI references the description → Accurate answers
```

## 📦 Setup & Installation

### Prerequisites
- Node.js 18+ installed
- Cloudflare account (free tier works!)
- Wrangler CLI installed

### 1. Clone the Repository
```bash
git clone https://github.com/Siwanii/AgentFlow_AI.git
cd AgentFlow_AI
```

### 2. Install Dependencies
```bash
npm install
```


### 3. Set up Cloudflare stuff
```bash
# Login (it'll open your browser)
npx wrangler login

# Create the database for embeddings
npx wrangler vectorize create ai-agent-vectorize --dimensions=768 --metric=cosine

# Create storage for documents
npx wrangler r2 bucket create ai-agent-documents
```

### 4. Configure your environment

Edit `wrangler.toml` (or create it):

```toml
name = "cf-ai-agent"
main = "src/index.js"
compatibility_date = "2025-09-01"

[[vectorize]]
binding = "VECTORIZE"
index_name = "ai-agent-vectorize"

[[r2_buckets]]
binding = "R2"
bucket_name = "ai-agent-documents"

[[durable_objects.bindings]]
name = "CHAT_SESSION"
class_name = "ChatSession"
script_name = "cf-ai-agent"
```


### 5. Deploy

Once everything is set up, just run:

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

### 🛠️ Technical Stack

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

## 🐛 Known Issues (I'm Working On Them!)
- **Image uploads** can sometimes have timing issues (race conditions are annoying)
- **Large PDFs** (>10MB) might timeout during upload
- **UI could be prettier** 

## 🎯 What's Next?

Things I want to add:
- [ ] Streaming responses (so you see the AI "typing")
- [ ] Better UI 
- [ ] Support for more file types
- [ ] Analytics dashboard to see usage
- [ ] Multi-language support

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature`
3. **Commit your changes**: `git commit -m 'Add feature'`
4. **Push to branch**: `git push origin feature`
5. **Open a Pull Request**

### Development Guidelines
- Follow existing code style
- Add comments for complex logic
- Test thoroughly before submitting.
- Update README if adding new features

## 🔐 Security & Privacy

- All data encrypted in transit (HTTPS)
- Documents stored securely in R2
- Session data isolated via Durable Objects
- No data shared with third parties
- Self-host for complete control


## 🙏 Acknowledgments

- **Cloudflare** for the amazing Workers platform
- **Meta** for open-sourcing Llama models
- **Coffee** for keeping me awake during debugging sessions
- Everyone who gave me feedback and encouragement


## 📧 Let's Connect!

**Siwani** - [LinkedIn](https://www.linkedin.com/in/siwanisah/)
**Email**: siwanishah8888@gmail.com

Project Link: [AgentFlow_AI](https://github.com/Siwanii/AgentFlow_AI)

---

**⭐ If you find this project helpful or interesting, please give it a star!**

---

**Built with ❤️ , determination, and a lot of debugging by Siwani** ☕💻
