/**
 * Cloudflare Workflow for coordinating AI chat operations
 * Handles complex multi-step AI interactions and state management
 */

export class ChatWorkflow {
  constructor() {
    this.steps = [];
    this.currentStep = 0;
    this.state = {};
    this.isComplete = false;
  }

  // Define workflow steps
  async defineWorkflow() {
    this.steps = [
      {
        name: 'validate_input',
        handler: this.validateInput.bind(this),
        retries: 3
      },
      {
        name: 'prepare_context',
        handler: this.prepareContext.bind(this),
        retries: 2
      },
      {
        name: 'call_ai',
        handler: this.callAI.bind(this),
        retries: 3
      },
      {
        name: 'process_response',
        handler: this.processResponse.bind(this),
        retries: 2
      },
      {
        name: 'update_state',
        handler: this.updateState.bind(this),
        retries: 2
      }
    ];
  }

  // Execute the workflow
  async execute(input, env) {
    try {
      await this.defineWorkflow();
      this.state = { input, env, startTime: Date.now() };

      for (let i = 0; i < this.steps.length; i++) {
        this.currentStep = i;
        const step = this.steps[i];
        
        console.log(`Executing step ${i + 1}/${this.steps.length}: ${step.name}`);
        
        let attempts = 0;
        let lastError = null;
        
        while (attempts < step.retries) {
          try {
            await step.handler();
            break; // Success, move to next step
          } catch (error) {
            lastError = error;
            attempts++;
            console.error(`Step ${step.name} failed (attempt ${attempts}/${step.retries}):`, error);
            
            if (attempts < step.retries) {
              // Wait before retry (exponential backoff)
              await this.sleep(Math.pow(2, attempts) * 1000);
            }
          }
        }
        
        if (attempts >= step.retries) {
          throw new Error(`Step ${step.name} failed after ${step.retries} attempts: ${lastError.message}`);
        }
      }

      this.isComplete = true;
      this.state.endTime = Date.now();
      this.state.duration = this.state.endTime - this.state.startTime;
      
      console.log(`Workflow completed in ${this.state.duration}ms`);
      return this.state.result;

    } catch (error) {
      console.error('Workflow execution failed:', error);
      this.state.error = error;
      throw error;
    }
  }

  // Step 1: Validate input
  async validateInput() {
    const { input } = this.state;
    
    if (!input.message || typeof input.message !== 'string') {
      throw new Error('Invalid message: must be a non-empty string');
    }
    
    if (input.message.length > 2000) {
      throw new Error('Message too long: maximum 2000 characters');
    }
    
    this.state.validation = {
      isValid: true,
      messageLength: input.message.length,
      timestamp: Date.now()
    };
    
    console.log('Input validation passed');
  }

  // Step 2: Prepare context for AI
  async prepareContext() {
    const { input } = this.state;
    
    // Get conversation history from Durable Object
    const conversationHistory = input.conversationHistory || [];
    
    // Prepare system prompt
    const systemPrompt = this.generateSystemPrompt(input.sessionId);
    
    // Format messages for AI
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: input.message }
    ];
    
    this.state.context = {
      messages,
      systemPrompt,
      conversationLength: conversationHistory.length,
      sessionId: input.sessionId
    };
    
    console.log(`Context prepared with ${conversationHistory.length} previous messages`);
  }

  // Step 3: Call AI service
  async callAI() {
    const { context, env } = this.state;
    
    const primaryModel = '@cf/meta/llama-3.1-8b-instruct';
    const fallbackModel = '@cf/meta/llama-2-7b-chat-fp16';

    try {
      const response = await env.AI.run(primaryModel, {
        messages: context.messages,
        max_tokens: 500,
        temperature: 0.7,
        top_p: 0.9,
        stream: false
      });
      
      this.state.aiResponse = {
        content: response.response || 'I apologize, but I was unable to generate a response.',
        model: 'llama-3.1-8b-instruct',
        timestamp: Date.now(),
        tokens: response.tokens || 0
      };
    
      
    } catch (error) {
      console.error('Primary AI call failed:', error);
      try {
        const response2 = await env.AI.run(fallbackModel, {
          prompt: context.messages.map(m => `${m.role}: ${m.content}`).join('\n'),
          max_tokens: 500,
          temperature: 0.7,
          top_p: 0.9
        });

        const content = response2.response || response2 || 'I apologize, but I was unable to generate a response.';
        this.state.aiResponse = {
          content,
          model: 'llama-2-7b-chat-fp16',
          timestamp: Date.now()
        };
        console.log('AI response generated successfully (fallback model)');

      } catch (error2) {
        console.error('Fallback AI call failed:', error2);
        // Final fallback response
        this.state.aiResponse = {
          content: `I apologize, but I'm experiencing technical difficulties. 
        Your message was: "${context.messages[context.messages.length - 1]?.content || 'unknown'}" 
        Please try again in a moment.`,
          model: 'fallback',
          timestamp: Date.now(),
          error: `${error.message}; fallback: ${error2.message}`
        };
      }
    }
  }

  // Step 4: Process AI response
  async processResponse() {
    const { aiResponse } = this.state;
    
    // Clean and validate response
    let processedContent = (aiResponse.content || '').toString().trim();
    
    // Basic content filtering
    if (processedContent.length === 0) {
      processedContent = "I apologize, but I couldn't generate a proper response. Please try rephrasing your question.";
    }
    
    // Truncate if too long
    if (processedContent.length > 2000) {
      processedContent = processedContent.substring(0, 1997) + '...';
    }
    
    this.state.processedResponse = {
      content: processedContent,
      originalLength: (aiResponse.content || '').toString().length,
      processedLength: processedContent.length,
      timestamp: Date.now()
    };
    
    console.log('Response processed and validated');
  }

  // Step 5: Update state and prepare result
  async updateState() {
    const { input, processedResponse, context } = this.state;
    
    // Prepare the final result
    this.state.result = {
      response: processedResponse.content,
      sessionId: context.sessionId,
      timestamp: Date.now(),
      conversationLength: context.conversationLength + 1,
      model: this.state.aiResponse.model,
      processingTime: Date.now() - this.state.startTime
    };
    
    // Update conversation history
    const updatedHistory = [
      ...(input.conversationHistory || []),
      { role: 'user', content: input.message, timestamp: Date.now() },
      { role: 'assistant', content: processedResponse.content, timestamp: Date.now() }
    ];
    
    this.state.result.conversationHistory = updatedHistory;
    
    console.log('State updated, workflow complete');
  }

  // Generate dynamic system prompt based on context
  generateSystemPrompt(sessionId) {
    const basePrompt = `You are a helpful AI assistant powered by Llama 3.x. You are having a conversation with a user. 
    Be friendly, informative, and helpful. Keep your responses concise but engaging. 
    If you don't know something, say so honestly.`;
    
    // Add session-specific context if available
    if (sessionId) {
      return `${basePrompt}\n\nYou are in session: ${sessionId}. Maintain context throughout this conversation.`;
    }
    
    return basePrompt;
  }

  // Utility function for delays
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get workflow status
  getStatus() {
    return {
      currentStep: this.currentStep,
      totalSteps: this.steps.length,
      isComplete: this.isComplete,
      state: this.state
    };
  }
}

// Workflow factory function
export function createChatWorkflow() {
  return new ChatWorkflow();
}
