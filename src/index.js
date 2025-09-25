/**
 * Main Cloudflare Worker for AI Chat Assistant
 * Integrates Workers AI (Llama 3.3), Durable Objects, WebSocket handling, and Workflows
 */

import { ChatSession } from './chat-session.js';
import { createChatWorkflow } from './workflow.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for development
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    // Route requests
    switch (path) {

      case '/':
    return new Response(`<h1>Welcome to AI Chat Assistant</h1>
<p>Use <code>/api/chat</code> endpoint to send messages.</p>`, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html' }
    });
    
      case '/api/chat':
        return this.handleChatRequest(request, env, corsHeaders);
      
      case '/api/health':
        return this.handleHealthCheck(corsHeaders);
      
      case '/ws':
        return this.handleWebSocket(request, env);
      
      default:
        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
  },

  async handleChatRequest(request, env, corsHeaders) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { 
        status: 405, 
        headers: corsHeaders 
      });
    }

    try {
      const { message, sessionId, conversationHistory = [] } = await request.json();

      if (!message) {
        return new Response(JSON.stringify({ error: 'Message is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get or create Durable Object instance
      const durableObjectId = env.CHAT_SESSION.idFromName(sessionId || 'default');
      const durableObject = env.CHAT_SESSION.get(durableObjectId);

      // Prepare conversation context for AI
      const messages = conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Add current user message
      messages.push({
        role: 'user',
        content: message
      });

      // Use workflow to process the chat request
      const workflow = createChatWorkflow();
      const result = await workflow.execute({
        message,
        sessionId: sessionId || 'default',
        conversationHistory
      }, env);

      // Store the conversation in Durable Object
      await durableObject.fetch('http://internal/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sessionId || 'default',
          messages: result.conversationHistory
        })
      });

      return new Response(JSON.stringify({
        response: result.response,
        sessionId: result.sessionId,
        timestamp: result.timestamp,
        conversationLength: result.conversationLength,
        model: result.model,
        processingTime: result.processingTime
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        }
      });

    } catch (error) {
      console.error('Chat request error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  async callLlamaAI(env, messages) {
    try {
      // Prepare the prompt for Llama 3.3
      const systemPrompt = `You are a helpful AI assistant. You are having a conversation with a user. 
      Be friendly, informative, and helpful. Keep your responses concise but engaging. 
      If you don't know something, say so honestly.`;

      // Format messages for Llama 3.3
      const formattedMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];

      // Call Llama 3.3 via Workers AI
      const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
        messages: formattedMessages,
        max_tokens: 500,
        temperature: 0.7,
        top_p: 0.9,
        stream: false
      });

      return response.response || 'I apologize, but I was unable to generate a response.';

    } catch (error) {
      console.error('AI call error:', error);
      
      // Fallback response if AI call fails
      return `I apologize, but I'm experiencing technical difficulties. 
      Your message was: "${messages[messages.length - 1]?.content || 'unknown'}" 
      Please try again in a moment.`;
    }
  },

  async handleWebSocket(request, env) {
    // Get or create Durable Object instance for WebSocket handling
    const durableObjectId = env.CHAT_SESSION.idFromName('websocket-session');
    const durableObject = env.CHAT_SESSION.get(durableObjectId);

    // Forward WebSocket request to Durable Object
    return durableObject.fetch(request);
  },

  async handleHealthCheck(corsHeaders) {
    return new Response(JSON.stringify({
      status: 'healthy',
      timestamp: Date.now(),
      service: 'AI Chat Assistant',
      version: '1.0.0'
    }), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json' 
      }
    });
  }
};

// Export the Durable Object class
export { ChatSession };
