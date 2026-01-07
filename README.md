# AI Chat Assistant - Smart Digital Helper

**Intelligent AI Agent** - A AI chat application built on Cloudflare Workers AI with autonomous function calling (tool use) and Retrieval Augmented Generation (RAG) capabilities.

## 🎯 Key Features

- 🤖 **Smart Digital Helper**: Powered by Llama 3.3 with autonomous function calling - the AI decides when to use tools
- 💻 **Programming & Debugging**: Help with React, .NET, Python, SQL, and more
- 📚 **Studying & Research**: CS concepts, papers, explanations with step-by-step format
- 📝 **Writing Assistance**: Emails, resumes, LinkedIn posts, documentation
- 🧠 **Problem-Solving**: Step-by-step explanations and guidance
- 🌐 **General Knowledge**: Current events, facts, and information
- 🚀 **Career Guidance**: Projects, interviews, portfolios
- 🔧 **Function Calling (Tool Use)**: AI autonomously uses tools like web search, weather, calculator, time, and currency conversion
- 📚 **RAG (Retrieval-Augmented Generation)**: Upload PDFs, text files, images, or URLs - AI reads and answers questions about your documents
- 💬 **ChatGPT-like Interface**: Modern, intuitive chat interface with voice input and file attachments
- 🎨 **Enhanced Formatting**: Beautiful markdown rendering with TL;DR summaries, step-by-step guides, code blocks, and visual hierarchy
- 🌙 **Dark Mode**: Toggle between light and dark themes with persistent preference
- ⚡ **Streaming Responses**: Real-time token-by-token streaming for instant feedback
- 📋 **Code Block Features**: Copy button, syntax highlighting (Prism.js), and proper formatting
- ⚠️ **Confidence Indicators**: Visual warnings when information may be uncertain
- 🎤 **Voice Input**: Speak your questions using Web Speech API
- 📎 **File Attachments**: Upload PDFs, text files, images, or paste URLs directly in chat
- 💾 **Conversation History**: Persistent chat sessions with context awareness
- 🔄 **Smart Image Handling**: Automatic retry logic for race conditions (Vectorize indexing delays)
- ⚡ **Edge Computing**: Deployed on Cloudflare's global network for low latency

## 🏗️ Architecture

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

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (installed automatically via nvm)
- Cloudflare account with Workers AI enabled
- Wrangler CLI installed (`npm install -g wrangler`)

### Setup

1. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

2. **Create Vectorize Index** (for RAG):
   ```bash
   wrangler vectorize create rag-documents --dimensions=384 --metric=cosine
   ```
   
   Or use the setup script:
   ```bash
   ./setup-vectorize.sh
   ```

3. **Run Locally**:
   ```bash
   ./run-local.sh
   ```
   
   Or use npm:
   ```bash
   npm run dev
   ```

4. **Access the Application**:
   - Frontend: http://localhost:8787/cf_ai_chat-assistant/
   - API: http://localhost:8787/api/health

## 📋 Available Tools (Function Calling)

The AI agent can autonomously use these tools:

1. **`search_web`** - Search the web for current information (uses DuckDuckGo & Wikipedia)
   - Automatically used for 2025 information, current events, recent news, acquisitions, mergers
2. **`get_weather`** - Get current weather for any location
3. **`calculate`** - Perform mathematical calculations
4. **`get_current_time`** - Get current date and time
5. **`convert_currency`** - Convert between different currencies

The AI decides when to use these tools based on your questions!

## 📚 RAG (Retrieval-Augmented Generation)

### Supported Document Types

- **PDF files** (.pdf) - Max size: 10MB
- **Text files** (.txt) - Max size: 10MB
- **Image files** (.jpg, .jpeg, .png, .gif, .webp, .bmp) - Max size: 5MB (5120 KB)
- **URLs** - Paste any URL to extract and process content

### How It Works

1. **Upload**: Click the `+` button or paste a URL in the input bar
2. **Processing**: 
   - For PDFs/Text: Extracts text, chunks it, creates embeddings, stores in Vectorize
   - For Images: Uses Cloudflare Workers AI vision models to generate descriptions
3. **Query**: Ask questions about your document (summarize, explain, analyze, review)
4. **Response**: AI uses relevant document chunks to answer your questions

### Image Upload & Race Condition Handling

When you upload an image and immediately ask about it, Cloudflare Vectorize takes 15-30 seconds to index the content. The system automatically handles this:

- **Automatic Retry Logic**: If an image isn't found immediately, the system retries with exponential backoff (2s, 4s, 8s, 16s, 32s)
- **Direct Document ID Queries**: Bypasses similarity search to query by document ID directly
- **Smart Prioritization**: Always uses the most recently uploaded image, even if multiple images exist
- **Graceful Fallback**: Clear error messages if the image is still processing after retries

### Example Queries

- "Summarize this document"
- "Explain the main points"
- "What does this PDF say about X?"
- "Analyze this document"
- "Review my resume"
- "What's in this image?"

### Technical Details

- **Embedding Model**: `@cf/baai/bge-small-en-v1.5` (384 dimensions)
- **Chunk Size**: 500 characters with 50 character overlap
- **Top K Results**: Up to 30 most similar chunks (filtered and prioritized)
- **Similarity Metric**: Cosine similarity
- **Image Models**: LLaVA, UForm, Llama Vision (tries multiple models)
- **Race Condition Handling**: Automatic retry with exponential backoff (5 retries, up to 32s delay)
- **Image Query Detection**: Smart detection of image-related queries ("what's in this image?", "explain this image", etc.)
- **Most Recent Image Priority**: Always uses the most recently uploaded image, filtering out older images

### Managing Vectorize Index

To clear old documents/images from Vectorize, you can use the Wrangler CLI:
```bash
# List all vectors in the index
wrangler vectorize query rag-documents --query="test" --top=100

# To delete specific vectors, you'll need to use the Cloudflare API or dashboard
```

## 🎨 Features

### Interface

- **Modern UI**: Clean, responsive design with Inter font
- **Dark Mode**: Toggle between light and dark themes (preference saved in localStorage)
- **Message Bubbles**: AI messages with 🤖 icon, user messages with 👤 icon
- **Quick Chips**: Clickable suggestion chips for common queries (programming, algorithms, career, etc.)
- **Status Indicator**: Live/Offline status in header
- **File Attachments**: Visual display of attached files/URLs with file sizes
- **Streaming Responses**: Real-time token-by-token display for instant feedback
- **Enhanced Formatting**: 
  - TL;DR summaries in highlighted blue boxes (without "TL;DR:" label)
  - Step-by-step guides with numbered sections
  - Syntax-highlighted code blocks with Prism.js
  - Copy button on code blocks (appears on hover)
  - Proper markdown rendering (headings, lists, bold, inline code)
  - Visual hierarchy with clear sections
  - Preserved indentation and line breaks in code
- **Confidence Indicators**: Warning badges when information may be uncertain

### Voice Input

- Click the 🎤 microphone icon
- Speak your question
- Automatic speech-to-text conversion

### File Upload

- Click the ➕ button to upload PDF, text, or image files
- Or paste a URL directly in the input bar
- Files are processed automatically and stored in Vectorize

## 🔌 API Endpoints

### Health Check
```bash
GET /api/health
```

### Chat
```bash
POST /api/chat
Content-Type: application/json

{
  "message": "Your question here",
  "sessionId": "optional-session-id"
}
```

### Document Upload
```bash
POST /api/upload
Content-Type: multipart/form-data

file: [PDF/Text/Image file]
```

## 🧪 Testing

### Test Chat API
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is the weather in San Francisco?",
    "sessionId": "test-session"
  }'
```

### Test Document Upload
```bash
curl -X POST http://localhost:8787/api/upload \
  -F "file=@document.pdf"
```

## 📁 Project Structure

```
.
├── src/
│   ├── index.js           # Main Worker entry point
│   ├── workflow.js         # AI agent workflow with function calling
│   ├── functions.js        # Tool definitions and implementations
│   ├── rag.js             # RAG implementation (chunking, embeddings, Vectorize)
│   └── chat-session.js    # Durable Object for session management
├── cf_ai_chat-assistant/
│   └── index.html         # Frontend chat interface
├── wrangler.toml          # Cloudflare configuration
├── package.json           # Dependencies
├── run-local.sh           # Local development script
├── setup-vectorize.sh     # Vectorize index setup script
└── README.md              # This file
```

## 🔧 Configuration

### wrangler.toml

- **AI Binding**: `@cloudflare/ai` for Llama 3.3
- **Vectorize**: `rag-documents` index (384 dimensions, cosine metric)
- **Durable Objects**: `ChatSession` for conversation state

### Environment Variables

- `AI_BINDING` - Cloudflare Workers AI binding
- `VECTORIZE_BINDING` - Vectorize index binding
- `CHAT_SESSION_BINDING` - Durable Object binding

## 🚀 Deployment

### Deploy to Cloudflare

```bash
# Deploy to production
wrangler deploy

# Deploy to staging
wrangler deploy --env staging
```

### Verify Deployment

```bash
# Check Vectorize index
wrangler vectorize list

# Check Durable Objects
wrangler durable-objects list
```

## 🛠️ Development

### Local Development

The project uses `wrangler dev` with remote bindings to enable:
- Vectorize bindings (requires remote connection)
- Workers AI access
- Durable Objects

**Note**: Vectorize requires remote mode (not `--local`)

### Response Quality & Formatting

The AI is configured to provide high-quality, well-formatted responses:
- **TL;DR First**: Every response starts with a concise 1-2 sentence summary (highlighted in blue box)
- **Structured Format**: Clear step-by-step breakdowns with numbered sections
- **Streaming**: Token-by-token streaming for real-time response display
- **Visual Hierarchy**: Proper headings, bullet points, and code blocks
- **Code Formatting**: Syntax highlighting, copy buttons, preserved indentation
- **Error Handling**: Confidence indicators when tools fail or information is uncertain
- **Clean Output**: No verbose tool mentions or unnecessary disclaimers
- **Complete Responses**: Increased token limit (4000) to ensure full, complete answers

## 📝 Key Technologies

- **Cloudflare Workers AI**: Llama 3.3 for AI responses with streaming support
- **Cloudflare Vectorize**: Vector database for RAG with automatic retry logic
- **Cloudflare Durable Objects**: Persistent session state
- **BGE Embeddings**: `@cf/baai/bge-small-en-v1.5` for document embeddings
- **Prism.js**: Syntax highlighting for code blocks
- **Web Speech API**: Voice input in browser
- **Server-Sent Events (SSE)**: Streaming responses via text/event-stream
- **Vision Models**: LLaVA, UForm, Llama Vision for image understanding

## 🎯 How Function Calling Works

1. **User asks a question** (e.g., "What's the weather in SF?")
2. **AI analyzes** the question and decides to use `get_weather` tool
3. **Tool executes** and returns weather data
4. **AI synthesizes** the tool result into a natural response
5. **User receives** a direct answer (no mention of tools)

The AI autonomously decides when tools are needed!

## 📚 RAG Pipeline

1. **Document Upload**: PDF/text file, image, or URL
2. **Text Extraction**: 
   - PDFs: Extract text from BT/ET blocks, text objects, streams (with metadata filtering)
   - Images: Use vision models to generate descriptions (with `[IMAGE DESCRIPTION]` prefix)
   - URLs: Fetch and extract HTML content
3. **Chunking**: Split into ~500 character chunks with 50 character overlap (filtered for quality)
4. **Embedding**: Create 384-dimensional vectors using BGE model
5. **Storage**: Store in Vectorize with metadata, timestamps, and document IDs
6. **Query**: User asks question about document
7. **Similarity Search**: Find relevant chunks using vector similarity
   - **Race Condition Handling**: If image not found, retry with document ID query (exponential backoff)
   - **Image Prioritization**: Always use most recent image, filter out older images
8. **Context Injection**: Add relevant chunks to AI prompt (only from most recent document for images)
9. **Response**: AI answers using document context (streamed token-by-token)

## 🎯 AI Capabilities

The AI is configured as a smart digital helper that can assist with:

- **Programming**: Debug code, explain concepts, write code snippets, review code
- **Studying**: Explain CS concepts, help with homework, break down complex topics
- **Writing**: Help with emails, resumes, LinkedIn posts, documentation
- **Problem-Solving**: Guide through problems step-by-step with clear explanations
- **Career**: Interview prep, portfolio review, project ideas, career advice
- **General Knowledge**: Answer questions with current information (uses web search for 2025 data)

### Response Format

The AI provides well-structured responses with:
- **TL;DR Summary**: Quick 1-2 sentence summary at the top (highlighted in blue box, no "TL;DR:" label)
- **Structured Content**: Clear step-by-step breakdowns with numbered sections
- **Code Examples**: Properly formatted code blocks with syntax highlighting (Prism.js) and copy buttons
- **Streaming Display**: Real-time token-by-token rendering for instant feedback
- **Visual Hierarchy**: Headings, bullet points, and clear sections for easy reading
- **Confidence Indicators**: Visual warnings when information may be uncertain
- **Complete Answers**: Full responses with no truncation (4000 token limit)

## 🤝 Contributing

This is a production-ready AI agent implementation. Key improvements could include:

- Additional tools (email, calendar, etc.)
- Better PDF parsing (using pdf.js)
- Multi-language support
- User authentication
- Enhanced image processing
- Hybrid search (BM25 + vector search)
- Semantic chunking improvements

## 📄 License

MIT

## 🙏 Acknowledgments

- Cloudflare Workers AI for Llama 3.3
- Cloudflare Vectorize for vector storage
- Cloudflare Durable Objects for session management
- DuckDuckGo API for web search
- Wikipedia API for authoritative information

---

**Built with ❤️ using Cloudflare Workers AI**
