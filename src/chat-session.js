/**
 * Durable Object for managing chat sessions and conversation state
 * Provides memory and state management for the AI chat application
 */

export class ChatSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket connections for real-time chat
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // Handle HTTP requests
    switch (path) {
      case '/api/sessions':
        return this.handleGetSessions(request);
      case '/api/sessions/create':
        return this.handleCreateSession(request);
      case '/api/sessions/clear':
        return this.handleClearSession(request);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  async handleWebSocket(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    
    // Store the WebSocket connection
    const sessionId = this.generateSessionId();
    this.sessions.set(sessionId, {
      websocket: server,
      messages: [],
      createdAt: Date.now()
    });

    // Handle incoming messages
    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        await this.handleMessage(sessionId, data);
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        server.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message'
        }));
      }
    });

    // Handle connection close
    server.addEventListener('close', () => {
      this.sessions.delete(sessionId);
    });

    // Send session ID to client
    server.send(JSON.stringify({
      type: 'session_created',
      sessionId: sessionId
    }));

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleMessage(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { type, message, userMessage } = data;

    switch (type) {
      case 'user_message':
        // Store user message
        session.messages.push({
          role: 'user',
          content: userMessage,
          timestamp: Date.now()
        });

        // Send to AI processing
        await this.processWithAI(sessionId, userMessage);
        break;

      case 'get_history':
        // Send conversation history
        session.websocket.send(JSON.stringify({
          type: 'history',
          messages: session.messages
        }));
        break;

      case 'clear_history':
        // Clear conversation history
        session.messages = [];
        session.websocket.send(JSON.stringify({
          type: 'history_cleared'
        }));
        break;
    }
  }

  async processWithAI(sessionId, userMessage) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      // Prepare conversation context for AI
      const conversationHistory = session.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Call the AI service
      const aiResponse = await this.callAI(userMessage, conversationHistory);

      // Store AI response
      session.messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now()
      });

      // Send AI response to client
      session.websocket.send(JSON.stringify({
        type: 'ai_response',
        message: aiResponse,
        timestamp: Date.now()
      }));

    } catch (error) {
      console.error('AI processing error:', error);
      session.websocket.send(JSON.stringify({
        type: 'error',
        message: 'Failed to get AI response'
      }));
    }
  }

  async callAI(userMessage, conversationHistory) {
    // This will be called by the main worker that has AI binding
    // For now, return a placeholder response
    return `I received your message: "${userMessage}". This is a placeholder response from the AI assistant.`;
  }

  async handleGetSessions(request) {
    const sessions = Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      messageCount: session.messages.length,
      createdAt: session.createdAt
    }));

    return new Response(JSON.stringify({ sessions }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async handleCreateSession(request) {
    const sessionId = this.generateSessionId();
    this.sessions.set(sessionId, {
      messages: [],
      createdAt: Date.now()
    });

    return new Response(JSON.stringify({ sessionId }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async handleClearSession(request) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    
    if (sessionId && this.sessions.has(sessionId)) {
      this.sessions.get(sessionId).messages = [];
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
}
