/**
 * Cloudflare Workflow for coordinating AI Agent operations
 * Handles complex multi-step AI interactions with function calling (tool use)
 * Transforms the system from a chatbot to an intelligent agent that can decide when to use tools
 */

import { AVAILABLE_FUNCTIONS, executeFunction } from './functions.js';

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
        name: 'call_ai_agent',
        handler: this.callAIAgent.bind(this),
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
    
  }

  // Step 2: Prepare context for AI
  async prepareContext() {
    const { input } = this.state;
    
    // Get conversation history from Durable Object
    const conversationHistory = input.conversationHistory || [];
    
    // Check if the message requires current information
    const message = input.message.toLowerCase();
    const requiresCurrentInfo = this.requiresCurrentInformation(message);
    
    // Prepare system prompt (pass RAG context flag)
    const hasRagContext = !!(input.ragContext && input.ragContext.trim().length > 0);
    
    // Check if RAG context is image content
    const isImageContext = hasRagContext && (
      input.ragContext.includes('[IMAGE DESCRIPTION]') ||
      input.ragContext.toLowerCase().includes('image shows') ||
      input.ragContext.toLowerCase().includes('in the image') ||
      input.ragContext.toLowerCase().includes('the image contains') ||
      input.ragContext.toLowerCase().includes('picture shows') ||
      input.ragContext.toLowerCase().includes('photo shows')
    );
    
    const systemPrompt = this.generateSystemPrompt(input.sessionId, requiresCurrentInfo, hasRagContext, isImageContext);
    
    // Add RAG context if available
    let userMessage = input.message;
    if (hasRagContext) {
      // Detect what the user wants to do
      const lowerMessage = input.message.toLowerCase();
      let instruction = '';
      
      // Check if this is image content
      const isImageContent = input.ragContext.includes('[IMAGE DESCRIPTION]') || 
                            input.ragContext.toLowerCase().includes('image shows') ||
                            input.ragContext.toLowerCase().includes('in the image') ||
                            input.ragContext.toLowerCase().includes('the image contains') ||
                            input.ragContext.toLowerCase().includes('picture shows') ||
                            input.ragContext.toLowerCase().includes('photo shows');
      
      if (isImageContent) {
        // Instructions for image content
        if (lowerMessage.includes('summarize') || lowerMessage.includes('summary')) {
          instruction = 'Provide a concise summary of what is visible in the image based on the image description. Highlight the main elements, objects, people, text, or scenes visible in the image.';
        } else if (lowerMessage.includes('explain') || lowerMessage.includes('what is') || lowerMessage.includes('what\'s')) {
          // Added "what is" to catch "What is this?" or "What's in the photo?"
          instruction = 'Provide a detailed breakdown of the image. Identify the main subjects, any text found, the setting, and the overall composition based on the description.';
        }  else if (lowerMessage.includes('analyze')) {
          instruction = 'Analyze the image content. Describe what you see, identify key elements, and discuss what is visible in the image.';
        } else if (lowerMessage.includes('what') || lowerMessage.includes('describe') || lowerMessage.includes('see')) {
          instruction = 'Describe what is visible in the image based on the image description provided. Answer questions about what is in the image.';
        } else {
          instruction = 'Answer the user\'s question about the image using the image description provided. Describe what is visible in the image.';
        }
      } else {
        // Instructions for document content
        if (lowerMessage.includes('summarize') || lowerMessage.includes('summary')) {
          instruction = 'Provide a concise summary of the document content. Highlight the main points, key findings, and important information.';
        } else if (lowerMessage.includes('explain')) {
          instruction = 'Explain the document content in detail. Break down complex concepts and provide clear explanations.';
        } else if (lowerMessage.includes('analyze')) {
          instruction = 'Analyze the document content. Provide insights, identify patterns, and discuss implications.';
        } else {
          instruction = 'Answer the user\'s question using the document content. Provide a direct, comprehensive answer based on the information in the document.';
        }
      }
      
      // Check if image is still processing
      const isImageProcessing = input.ragContext && input.ragContext.includes('[IMAGE_PROCESSING]');
      
      // Check if this is image content (reuse the variable from above)
      const contentType = isImageContent ? 'IMAGE CONTENT' : 'DOCUMENT CONTENT';
      const contentNote = isImageContent 
        ? 'This is an image description generated from an uploaded image. Use this description to answer questions about what is in the image.'
        : 'This is document content from an uploaded file (PDF, text, or URL).';
      
      // If image is processing, use a simpler message format
      if (isImageProcessing) {
        userMessage = `USER REQUEST: ${input.message}\n\nNOTE: The image was uploaded but is still being processed by the system. This usually takes 15-30 seconds. Please inform the user that the image may still be processing and suggest they wait a moment and try again.`;
      } else {
        userMessage = `${contentType} (from uploaded file):\n\n${input.ragContext}\n\nUSER REQUEST: ${input.message}\n\nINSTRUCTIONS: ${instruction}\n\nCRITICAL RULES:
1. Use ONLY the ${isImageContent ? 'image description' : 'document content'} provided above
2. Do NOT use search_web or any other tools
3. Do NOT mention that you used tools
4. ${isImageContent ? 'This is an IMAGE DESCRIPTION - you CAN see the image through this description. Answer questions about what is in the image based on this description. NEVER say "I\'m not able to see images" or "I cannot access images" - you CAN see it through the description provided.' : 'Do NOT describe the PDF structure, metadata, or format'}
5. ${isImageContent ? 'Answer questions about the image naturally (e.g., "The image shows...", "In the image, I can see...", "The image contains..."). The description above IS the image - use it to answer.' : 'Do NOT say "The document contains" or "The document includes" or "I couldn\'t find information in the document" - just explain the actual content directly'}
6. Focus on the ${isImageContent ? 'IMAGE CONTENT and what is visible in the image' : 'SUBJECT MATTER and CONTENT of the document, not its technical structure'}
7. ${isImageContent ? 'If the image description is unclear, say so clearly. But if a description is provided, you CAN see the image.' : 'If the content is about metadata/PDF structure, ignore it and say "I couldn\'t find meaningful content in this document"'}
8. Provide a direct answer based on the ${isImageContent ? 'image description' : 'document content'} provided
9. ${isImageContent ? 'CRITICAL: The image description above IS the image. You can see it. Do not say you cannot see images.' : 'For resume/CV reviews: Provide specific feedback on formatting, content, skills, experience, and suggestions for improvement. Be constructive and helpful.'}`;
      }
    } else {
      // Check if user asked about an image but no RAG context was found
      const lowerMessage = input.message.toLowerCase();
      const isImageQuery = lowerMessage.includes('image') || 
                          lowerMessage.includes('picture') || 
                          lowerMessage.includes('photo') ||
                          lowerMessage.includes('what\'s there in') ||
                          lowerMessage.includes('what is there in') ||
                          lowerMessage.includes('what\'s in') ||
                          lowerMessage.includes('what is in') ||
                          lowerMessage.includes('what\'s this') ||
                          lowerMessage.includes('what is this') ||
                          lowerMessage.includes('what do you see');
      
      // Check if RAG context indicates image is processing
      const isImageProcessing = input.ragContext && input.ragContext.includes('[IMAGE_PROCESSING]');
      
      if (isImageQuery) {
        if (isImageProcessing) {
          console.warn('Image query detected - image is still processing');
        } else {
          console.warn('Image query detected but no RAG context found. Image may still be processing.');
        }
        // Don't add a message about this - let the AI handle it naturally
      } else {
      }
    }
    
    // Format messages for AI
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: userMessage }
    ];
    
    this.state.context = {
      messages,
      systemPrompt,
      conversationLength: conversationHistory.length,
      sessionId: input.sessionId,
      requiresCurrentInfo: requiresCurrentInfo,
      hasRagContext: !!(input.ragContext && input.ragContext.trim().length > 0)
    };
    
    if (requiresCurrentInfo) {
    }
    
  }

  // Detect if a message requires current/up-to-date information
  requiresCurrentInformation(message) {
    const lowerMessage = message.toLowerCase();
    
    // Keywords that indicate current information is needed
    const currentInfoKeywords = [
      'weather', 'temperature', 'forecast', 'how cold', 'how hot',
      'who is the', 'who are the', 'who is', 'who are',
      'current', 'now', 'today', 'recent', 'latest', 'newest',
      'president', 'prime minister', 'leader', 'ceo', 'governor',
      '2024', '2025', '2026', 'this year', 'last year', 'next year',
      'what happened', 'what\'s happening', 'what is happening',
      'news', 'update', 'latest news', 'recent news',
      'acquisition', 'merger', 'buyout', 'takeover', 'deal',
      'announced', 'announcement', 'launched', 'release', 'unveiled',
      'election', 'inauguration', 'inaugurated', 'sworn in'
    ];
    
    // Check if message contains current info keywords
    for (const keyword of currentInfoKeywords) {
      if (lowerMessage.includes(keyword)) {
        return true;
      }
    }
    
    // Check for questions about positions/roles
    const positionPatterns = [
      /who is (the )?(president|prime minister|leader|ceo|governor|mayor)/i,
      /who are (the )?(presidents|leaders|officials)/i,
      /current (president|leader|government|administration)/i
    ];
    
    for (const pattern of positionPatterns) {
      if (pattern.test(message)) {
        return true;
      }
    }
    
    // Check for business/company news patterns
    const businessPatterns = [
      /(recent|latest|new|current).*(acquisition|merger|buyout|deal|announcement)/i,
      /(acquisition|merger|buyout|deal).*(recent|latest|new|current)/i,
      /tell me about.*(acquisition|merger|buyout|deal)/i,
      /what.*(acquisition|merger|buyout|deal)/i
    ];
    
    for (const pattern of businessPatterns) {
      if (pattern.test(message)) {
        return true;
      }
    }
    
    return false;
  }

  // Step 3: Call AI Agent with function calling (tool use) capabilities
  // This transforms the system from a chatbot to an intelligent agent
  async callAIAgent() {
    const { context, env } = this.state;
    
    // Use Llama 3.3 which has better function calling support
    const primaryModel = '@cf/meta/llama-3.3-70b-instruct';
    const fallbackModel = '@cf/meta/llama-3.1-8b-instruct';
    
    // Maximum iterations for agent tool use loop (prevents infinite loops)
    const maxIterations = 5;
    let iteration = 0;
    let currentMessages = [...context.messages];
    let finalResponse = null;
    let toolsUsed = [];
    let functionCallsExecuted = [];


    while (iteration < maxIterations) {
      try {
        // Prepare the AI request
        const aiRequest = {
          messages: currentMessages,
          max_tokens: 4000, // Increased to allow complete responses with code examples
          temperature: 0.7,
          top_p: 0.9,
          stream: false // Streaming disabled for now - needs frontend support
        };

        // Add tools parameter for function calling
        // The agent will decide when to use these tools
        if (AVAILABLE_FUNCTIONS && AVAILABLE_FUNCTIONS.length > 0) {
          aiRequest.tools = AVAILABLE_FUNCTIONS;
        }

        const response = await env.AI.run(primaryModel, aiRequest);
        
        // Extract response text - handle different response formats
        let responseText = '';
        if (response) {
          responseText = response.response || response.text || response.content || '';
          if (typeof responseText !== 'string') {
            responseText = String(responseText || '');
          }
        }
        
        const rawResponse = response;
        
        // Agent decision: Check if the agent wants to use a tool
        const functionCalls = this.detectAgentFunctionCalls(responseText, rawResponse);
        
        if (functionCalls && functionCalls.length > 0) {
          const functionResults = [];
          for (const funcCall of functionCalls) {
            try {
              const result = await executeFunction(funcCall.name, funcCall.arguments || {});
              
              functionResults.push({
                name: funcCall.name,
                result: result
              });
              
              functionCallsExecuted.push({
                name: funcCall.name,
                arguments: funcCall.arguments,
                result: result,
                timestamp: Date.now()
              });
              
              toolsUsed.push(funcCall.name);
            } catch (error) {
              console.error(`❌ Error executing tool ${funcCall.name}:`, error);
              functionResults.push({
                name: funcCall.name,
                result: { 
                  error: error.message, 
                  success: false,
                  confidence: 'low',
                  fallback: true,
                  message: `Tool ${funcCall.name} failed: ${error.message}. Please provide answer based on your knowledge, but indicate uncertainty.`
                }
              });
            }
          }
          
          // Add agent's tool call request to conversation (minimal content to avoid verbose responses)
          currentMessages.push({
            role: 'assistant',
            content: '', // Empty content to avoid verbose explanations
            tool_calls: functionCalls
          });
          
          // Add tool results back to conversation for agent to process
          for (const funcResult of functionResults) {
            let toolContent = funcResult.result;
            
            // Check if tool failed and add confidence indicator
            if (toolContent && toolContent.success === false) {
              // Add instruction to AI to indicate uncertainty
              toolContent.confidence = 'low';
              toolContent.note = 'Tool execution failed. Answer based on your knowledge but indicate if you\'re uncertain.';
            } else if (toolContent && !toolContent.error) {
              // Tool succeeded - high confidence
              toolContent.confidence = 'high';
            }
            
            // For search_web, format the results better for the AI
            if (funcResult.name === 'search_web' && toolContent) {
              // Format search results in a more readable way
              let formattedContent = '';
              if (toolContent.answer) {
                formattedContent = `Search Answer: ${toolContent.answer}\n\n`;
              }
              if (toolContent.results && toolContent.results.length > 0) {
                formattedContent += 'Search Results:\n';
                toolContent.results.forEach((result, idx) => {
                  formattedContent += `${idx + 1}. ${result.title || 'Result'}\n`;
                  if (result.snippet) {
                    formattedContent += `   ${result.snippet}\n`;
                  }
                  if (result.url) {
                    formattedContent += `   Source: ${result.url}\n`;
                  }
                  formattedContent += '\n';
                });
              }
              if (toolContent.error) {
                formattedContent = `Search Error: ${toolContent.error}. ${toolContent.message || ''}`;
              }
              toolContent = formattedContent || JSON.stringify(funcResult.result);
            } else {
              toolContent = JSON.stringify(funcResult.result);
            }
            
            currentMessages.push({
              role: 'tool',
              name: funcResult.name,
              content: toolContent
            });
          }
          
          // Add instruction to give ONLY the direct answer - no tool mentions
          currentMessages.push({
            role: 'user',
            content: 'CRITICAL: Give ONLY the direct answer to the question. Use the search results above, but DO NOT mention searching, tools, or sources. Just provide the answer directly. Example: If asked "Who is the president?", answer "Joe Biden" (or whoever it is) - nothing else. No preambles, no explanations about searching.'
          });
          
          // Agent continues processing with tool results
          iteration++;
          continue;
        } else {
          // Agent has completed its task and provides final response
          // Ensure we have valid content
          if (!responseText || responseText.trim() === '') {
            responseText = "I apologize, but I couldn't generate a response. Please try rephrasing your question.";
            console.warn('⚠️ Empty response from AI, using fallback');
          }
          
          // Clean up verbose tool usage explanations
          let cleanedResponse = responseText.trim();
          
          // Add confidence indicator if tools failed
          const hasToolFailures = functionCallsExecuted.some(fc => fc.result && fc.result.success === false);
          if (hasToolFailures) {
            // Prepend a note about uncertainty if tools failed
            cleanedResponse = `⚠️ Note: Some information may be uncertain as some tools failed to execute.\n\n${cleanedResponse}`;
          }
          
          // Remove ALL phrases about tool usage, searching, or sources
          const verbosePatterns = [
            /I'm not able to provide[^.]*\.\s*/gi,
            /I can suggest using[^.]*\.\s*/gi,
            /You can use (the )?[^.]*tool[^.]*\.\s*/gi,
            /To use (the )?[^.]*tool[^.]*\.\s*/gi,
            /Please note that (this )?tool[^.]*\.\s*/gi,
            /Here's an example of what[^.]*\.\s*/gi,
            /Example Output[^.]*\.\s*/gi,
            /get_weather\s+[A-Z][^.]*\.\s*/gi, // Remove example tool commands like "get_weather San Francisco"
            /To get (the )?(most )?(up-to-date|latest|current) information[^.]*\.\s*/gi,
            /To find (the )?current information[^.]*\.\s*/gi,
            /I (will|need to|should|must|am going to|'ll) (use|search|look up)[^.]*\.\s*/gi,
            /I (will|need to|should|must) use (the )?(search_web|get_weather|get_current_time|calculate|convert_currency) tool[^.]*\.\s*/gi,
            /Using (the )?(search_web|get_weather|get_current_time|calculate|convert_currency) tool[^.]*\.\s*/gi,
            /I've searched (for|the web)[^.]*\.\s*/gi,
            /According to (the )?(latest|search results|my search|the search)[^.]*\.\s*/gi,
            /As of my knowledge cutoff[^.]*\.\s*/gi,
            /As of my knowledge in 2023[^.]*\.\s*/gi,
            /my knowledge in 2023[^.]*\.\s*/gi,
            /However, please note that my training data[^.]*\.\s*/gi,
            /my training data may be outdated[^.]*\.\s*/gi,
            /my training data only goes up until[^.]*\.\s*/gi,
            /my training data[^.]*\.\s*/gi,
            /However, I'm a large language model[^.]*\.\s*/gi,
            /I'm a large language model[^.]*\.\s*/gi,
            /For the most up-to-date information[^.]*\.\s*/gi,
            /I recommend checking[^.]*\.\s*/gi,
            /please note that[^.]*\.\s*/gi,
            /However, please note[^.]*\.\s*/gi,
            /However, I'm[^.]*\.\s*/gi,
            /I may not have the most up-to-date information[^.]*\.\s*/gi,
            /To get the most current information[^.]*\.\s*/gi,
            /I'll use the search_web tool[^.]*\.\s*/gi,
            /According to the latest information[^.]*\.\s*/gi,
            /According to my knowledge[^.]*\.\s*/gi,
            /Based on (the )?(search results|latest information|my search|the search)[^.]*\.\s*/gi,
            /I found that[^.]*\.\s*/gi,
            /The search (results|shows|indicates|reveals)[^.]*\.\s*/gi,
            /After (searching|using the tool|looking up)[^.]*\.\s*/gi,
            /(From|Based on) (the )?(search|latest information|web search)[^.]*\.\s*/gi,
            /(I|I'll|I will) (search|look up|check)[^.]*\.\s*/gi,
            /Let me (search|look up|check)[^.]*\.\s*/gi
          ];
          
          // Apply patterns multiple times to catch nested phrases
          for (let i = 0; i < 5; i++) {
            for (const pattern of verbosePatterns) {
              cleanedResponse = cleanedResponse.replace(pattern, '');
            }
          }
          
          // Additional cleanup: Remove sentences that start with disclaimers
          const disclaimerStarters = [
            /^As of my knowledge[^.]*\.\s*/gim,
            /^However, I'm[^.]*\.\s*/gim,
            /^However, please note[^.]*\.\s*/gim,
            /^my training data[^.]*\.\s*/gim,
            /^I may not have[^.]*\.\s*/gim,
            /^To get the most[^.]*\.\s*/gim,
            /^I'll use the[^.]*\.\s*/gim
          ];
          
          for (const pattern of disclaimerStarters) {
            cleanedResponse = cleanedResponse.replace(pattern, '');
          }
          
          // Clean up multiple spaces and newlines
          cleanedResponse = cleanedResponse.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
          
          // Check if response is about PDF metadata/structure or noise (not actual content)
          const metadataPhrases = [
            'the document content appears', 'the document starts with', 'the document includes',
            'the document also includes', 'the document contains', 'pdf file with',
            'breakdown of the content', 'here\'s a breakdown', 'metadata', 'xmp',
            'adobe indesign', 'bitspercomponent', 'colorspace', 'image object',
            'xmp core', 'adobe xmp core', 'embedded object', 'pdf structure'
          ];
          const noisePhrases = [
            'collection of fragments', 'anomalies', 'repetitive', 'random sequences',
            'discernible patterns', 'meaningful content', 'coherent', 'anomalous characters',
            'repeated sequences', 'random sequences of numbers', 'fragments and anomalies'
          ];
          
          const lowerResponse = cleanedResponse.toLowerCase();
          const metadataPhraseCount = metadataPhrases.filter(phrase => lowerResponse.includes(phrase)).length;
          const noisePhraseCount = noisePhrases.filter(phrase => lowerResponse.includes(phrase)).length;
          
          // Check for noise patterns in the response itself
          const hasRepeatedChars = /(.)\1{10,}/.test(cleanedResponse);
          const hasNumberSequences = /\d+\s+0\s+R(\s+\d+\s+0\s+R){3,}/.test(cleanedResponse);
          
          // If response has multiple metadata/noise phrases or contains noise patterns, replace it
          if (metadataPhraseCount >= 3 || 
              noisePhraseCount >= 2 || 
              (metadataPhraseCount >= 2 && cleanedResponse.length < 500) ||
              hasRepeatedChars ||
              hasNumberSequences) {
            cleanedResponse = "I couldn't extract meaningful content from this PDF. The document appears to contain mostly metadata, structural information, or unreadable text (possibly image-based or corrupted). Please try:\n\n1. Converting the PDF to a text file (.txt) and uploading that\n2. Copying the PDF text content to a text file\n3. Using a URL to an article or webpage instead\n4. Ensuring the PDF contains selectable text (not just images)\n5. If the PDF is scanned, use OCR to extract text first";
            console.warn('⚠️ Response appears to be about PDF metadata/noise, replaced with helpful message');
          }
          
          // Clean up extra spaces and punctuation
          cleanedResponse = cleanedResponse
            .replace(/\s+/g, ' ')
            .replace(/\.\s*\./g, '.')
            .replace(/^\s*[.,]\s*/g, '')
            .trim();
          
          // Clean up multiple spaces and newlines
          cleanedResponse = cleanedResponse.replace(/\s+/g, ' ').trim();
          
          // If cleaning removed everything, use original
          if (cleanedResponse.length < 10) {
            cleanedResponse = responseText.trim();
          }
          
          finalResponse = {
            content: cleanedResponse,
            model: 'llama-3.3-70b-instruct',
            timestamp: Date.now(),
            tokens: response?.tokens || 0,
            toolsUsed: toolsUsed,
            functionCallsExecuted: functionCallsExecuted,
            agentIterations: iteration
          };
          console.log(`✅ Agent completed task after ${iteration} tool use iteration(s)`, {
            responseLength: cleanedResponse.length,
            toolsUsed: toolsUsed.length
          });
          break;
        }
        
      } catch (error) {
        console.error(`❌ Agent call failed (iteration ${iteration + 1}):`, error);
        
        // Check if it's an authentication error
        const errorMessage = error.message || String(error);
        const isAuthError = errorMessage.includes('Not logged in') || 
                           errorMessage.includes('not logged in') ||
                           errorMessage.includes('authentication') ||
                           errorMessage.includes('login');
        
        if (isAuthError && iteration === 0) {
          // Provide helpful error message for authentication issues
          finalResponse = {
            content: `I apologize, but I'm unable to process your request because Cloudflare authentication is required.

To fix this, please run:
1. \`wrangler login\` to authenticate with Cloudflare
2. Or ensure you're logged in with: \`wrangler whoami\`

This is required to use Cloudflare Workers AI. Once authenticated, I'll be able to help you!`,
            model: 'error-auth',
            timestamp: Date.now(),
            error: 'Authentication required',
            toolsUsed: [],
            functionCallsExecuted: []
          };
          console.error('❌ Authentication error - user needs to run: wrangler login');
          break;
        }
        
        // Try fallback model on first iteration only (if not auth error)
        if (iteration === 0 && !isAuthError) {
          try {
            console.log('🔄 Trying fallback model...');
            const response2 = await env.AI.run(fallbackModel, {
              messages: currentMessages,
              max_tokens: 4000, // Increased to allow complete responses with code examples
        temperature: 0.7,
        top_p: 0.9,
        stream: false
      });
      
            const content = response2.response || response2 || 'I apologize, but I was unable to generate a response.';
            finalResponse = {
              content,
        model: 'llama-3.1-8b-instruct',
              timestamp: Date.now(),
              toolsUsed: [],
              functionCallsExecuted: []
            };
            console.log('✅ Response generated with fallback model');
            break;
          } catch (error2) {
            console.error('❌ Fallback model also failed:', error2);
            // Check if fallback also has auth error
            const error2Message = error2.message || String(error2);
            if (error2Message.includes('Not logged in') || error2Message.includes('not logged in')) {
              finalResponse = {
                content: `I apologize, but I'm unable to process your request because Cloudflare authentication is required.

To fix this, please run:
1. \`wrangler login\` to authenticate with Cloudflare
2. Or ensure you're logged in with: \`wrangler whoami\`

This is required to use Cloudflare Workers AI. Once authenticated, I'll be able to help you!`,
                model: 'error-auth',
                timestamp: Date.now(),
                error: 'Authentication required',
                toolsUsed: [],
                functionCallsExecuted: []
              };
              break;
            }
            throw error2;
          }
        } else if (!isAuthError) {
          throw error;
        }
      }
    }

    // Handle case where max iterations reached
    if (!finalResponse) {
      finalResponse = {
        content: `I apologize, but I'm experiencing technical difficulties processing your request. 
        I attempted to use tools ${maxIterations} times but couldn't complete the task. 
        Please try rephrasing your question or contact support.`,
        model: 'error',
        timestamp: Date.now(),
        error: 'Max agent iterations reached',
        toolsUsed: toolsUsed,
        functionCallsExecuted: functionCallsExecuted
      };
    }

    this.state.aiResponse = finalResponse;
    this.state.agentMetadata = {
      toolsUsed: toolsUsed,
      functionCallsExecuted: functionCallsExecuted,
      iterations: iteration
    };
  }

  // Detect when the agent decides to use a function/tool
  // This is the core of the agent's decision-making capability
  detectAgentFunctionCalls(responseText, rawResponse) {
    const functionCalls = [];
    
    // Method 1: Check for structured tool_calls in response (native function calling)
    if (rawResponse.tool_calls && Array.isArray(rawResponse.tool_calls)) {
      return rawResponse.tool_calls.map(call => ({
        name: call.function?.name || call.name,
        arguments: typeof call.function?.arguments === 'string' 
          ? JSON.parse(call.function.arguments) 
          : call.function?.arguments || call.arguments || {}
      }));
    }
    
    // Method 2: Check for function_call property (OpenAI-style)
    if (rawResponse.function_call) {
      const funcCall = rawResponse.function_call;
      return [{
        name: funcCall.name,
        arguments: typeof funcCall.arguments === 'string' 
          ? JSON.parse(funcCall.arguments) 
          : funcCall.arguments || {}
      }];
    }
    
    // Method 3: Parse JSON function calls from agent's response
    try {
      const jsonPatterns = [
        /\{[\s\S]*?"(?:function|name|tool)"[\s\S]*?\}/g,
        /\{[\s\S]*?"function_name"[\s\S]*?\}/g,
        /\{[\s\S]*?"tool_name"[\s\S]*?\}/g
      ];
      
      for (const pattern of jsonPatterns) {
        const matches = responseText.match(pattern);
        if (matches) {
          for (const match of matches) {
            try {
              const parsed = JSON.parse(match);
              const funcName = parsed.function || parsed.name || parsed.tool_name || parsed.function_name;
              if (funcName && AVAILABLE_FUNCTIONS.some(f => f.function.name === funcName)) {
                functionCalls.push({
                  name: funcName,
                  arguments: parsed.arguments || parsed.args || parsed.params || {}
                });
              }
            } catch (e) {
              // Not valid JSON, continue
            }
          }
        }
      }
    } catch (e) {
      // Continue to other detection methods
    }
    
    // Method 4: Agent explicit function call markers
    // Format: [TOOL: function_name(arg1="value1", arg2="value2")]
    const toolCallPattern = /\[TOOL:\s*(\w+)\s*\(([^)]*)\)\]/i;
    const toolCallMatch = responseText.match(toolCallPattern);
    if (toolCallMatch) {
      const funcName = toolCallMatch[1];
      const argsString = toolCallMatch[2];
      const args = this.parseFunctionArguments(argsString);
      if (AVAILABLE_FUNCTIONS.some(f => f.function.name === funcName)) {
        functionCalls.push({
          name: funcName,
          arguments: args
        });
      }
    }
    
    // Method 5: Natural language detection - agent indicates tool usage
    // Look for patterns where agent decides to use tools
    
    // Priority: Auto-trigger tools based on user query (before checking AI response)
    const userMessage = this.state.context?.messages?.find(m => m.role === 'user')?.content || '';
    const lowerUserMessage = userMessage.toLowerCase();
    
    // Auto-trigger get_weather for weather queries
    if (lowerUserMessage.includes('weather') || lowerUserMessage.includes('temperature') || 
        lowerUserMessage.includes('forecast') || lowerUserMessage.includes('how cold') || 
        lowerUserMessage.includes('how hot')) {
      const args = this.extractArgumentsFromText(userMessage, 'get_weather');
      if (!args.location || args.location.trim() === '') {
        // Try to extract location from user message
        const locationMatch = userMessage.match(/(?:weather|temperature|forecast).*?(?:in|at|for)\s+([A-Z][^.!?]+?)(?:[.!?]|$)/i) ||
                              userMessage.match(/(?:in|at|for)\s+([A-Z][^.!?]+?)(?:[.!?]|$)/i);
        args.location = locationMatch ? locationMatch[1].trim() : 'San Francisco'; // Default fallback
      }
      functionCalls.push({
        name: 'get_weather',
        arguments: args
      });
      console.log('🌤️ Auto-triggered get_weather for weather query:', args.location);
      return functionCalls; // Return early since we found what we need
    }
    
    // Auto-trigger search_web for current information queries
    const requiresCurrentInfo = this.state.context?.requiresCurrentInfo;
    // Also check directly for 2025/2026 keywords in user message
    const hasYearKeywords = lowerUserMessage.includes('2025') || 
                           lowerUserMessage.includes('2026') ||
                           lowerUserMessage.includes('this year') ||
                           lowerUserMessage.includes('current year');
    
    if (requiresCurrentInfo || hasYearKeywords) {
      const args = this.extractArgumentsFromText(responseText, 'search_web');
      // Use the original user message as query if no specific query extracted
      if (!args.query || args.query.trim() === '') {
        args.query = userMessage || 'current information';
      }
      // Ensure 2025/2026 is in the query if the user mentioned it
      if ((lowerUserMessage.includes('2025') || lowerUserMessage.includes('2026')) && 
          !args.query.includes('2025') && !args.query.includes('2026')) {
        if (lowerUserMessage.includes('2026')) {
          args.query = `${args.query} 2026`;
        } else if (lowerUserMessage.includes('2025')) {
          args.query = `${args.query} 2025`;
        }
      }
      functionCalls.push({
        name: 'search_web',
        arguments: args
      });
      console.log('🔍 Auto-triggered search_web for current information query:', args.query);
      return functionCalls; // Return early since we found what we need
    }
    
    const functionNames = AVAILABLE_FUNCTIONS.map(f => f.function.name);
    for (const funcName of functionNames) {
      // Agent decision patterns
      const agentPatterns = [
        new RegExp(`(?:I (?:will|need to|should|must|can) (?:call|use|invoke|execute)|Let me (?:call|use|get|fetch)|I'll (?:call|use|get))\\s+${funcName}`, 'i'),
        new RegExp(`${funcName}\\s*\\(`, 'i'), // Direct function call syntax
        new RegExp(`(?:using|via|with)\\s+${funcName}`, 'i'),
        new RegExp(`(?:need|require|should use)\\s+${funcName}`, 'i')
      ];
      
      for (const regex of agentPatterns) {
        if (regex.test(responseText)) {
          const args = this.extractArgumentsFromText(responseText, funcName);
          const funcDef = AVAILABLE_FUNCTIONS.find(f => f.function.name === funcName);
          const requiredParams = funcDef?.function.parameters?.required || [];
          
          // Only add if we have meaningful arguments or if the function doesn't require them
          if (Object.keys(args).length > 0 || requiredParams.length === 0) {
            functionCalls.push({
              name: funcName,
              arguments: args
            });
            break;
          }
        }
      }
    }
    
    return functionCalls.length > 0 ? functionCalls : null;
  }

  // Parse function arguments from string format
  parseFunctionArguments(argsString) {
    const args = {};
    if (!argsString || argsString.trim() === '') return args;
    
    const parts = argsString.match(/(\w+)\s*=\s*['"]([^'"]+)['"]|(\w+)\s*=\s*(\S+)/g) || [];
    
    for (const part of parts) {
      const match = part.match(/(\w+)\s*=\s*(?:['"]([^'"]+)['"]|(\S+))/);
      if (match) {
        const key = match[1];
        const value = match[2] || match[3];
        if (!isNaN(value) && value.trim() !== '') {
          args[key] = parseFloat(value);
        } else {
          args[key] = value;
        }
      }
    }
    
    return args;
  }

  // Extract function arguments from natural language (agent's reasoning)
  extractArgumentsFromText(text, functionName) {
    const args = {};
    const funcDef = AVAILABLE_FUNCTIONS.find(f => f.function.name === functionName);
    if (!funcDef) return args;
    
    switch (functionName) {
      case 'get_weather':
        const locationPatterns = [
          /(?:location|city|place|in|at|for)\s+(?:is\s+)?['"]?([A-Z][^'",.!?]+?)(?:['"]|,|\.|!|\?|$)/i,
          /(?:weather\s+in|weather\s+for|weather\s+at)\s+['"]?([A-Z][^'",.!?]+?)(?:['"]|,|\.|!|\?|$)/i,
          /['"]([A-Z][^'"]+?)['"]/
        ];
        for (const pattern of locationPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            args.location = match[1].trim();
            break;
          }
        }
        if (/\b(fahrenheit|f)\b/i.test(text)) args.unit = 'fahrenheit';
        else if (/\b(celsius|c)\b/i.test(text)) args.unit = 'celsius';
        break;
      
      case 'calculate':
        const calcPatterns = [
          /(?:calculate|compute|solve|evaluate|what is|what's)\s+(.+?)(?:\.|$|\?)/i,
          /(\d+\s*[+\-*/]\s*\d+)/,
          /(?:equals?|is)\s+(.+?)(?:\.|$|\?)/i
        ];
        for (const pattern of calcPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            args.expression = match[1].trim();
            break;
          }
        }
        break;
      
      case 'convert_currency':
        const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:dollars?|euros?|pounds?|yen|yuan|usd|eur|gbp|jpy|cny)?/i);
        if (amountMatch) args.amount = parseFloat(amountMatch[1]);
        const currencyCodes = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD'];
        const fromMatch = text.match(/(?:from|convert)\s+([A-Z]{3})/i);
        const toMatch = text.match(/(?:to|into)\s+([A-Z]{3})/i);
        if (fromMatch && currencyCodes.includes(fromMatch[1].toUpperCase())) args.from = fromMatch[1].toUpperCase();
        if (toMatch && currencyCodes.includes(toMatch[1].toUpperCase())) args.to = toMatch[1].toUpperCase();
        break;
      
      case 'get_current_time':
        const tzPatterns = [
          /(?:timezone|time zone|in)\s+(?:is\s+)?['"]?([A-Z][^'",.!?]+?)(?:['"]|,|\.|!|\?|$)/i,
          /(?:time\s+in|what time\s+in)\s+['"]?([A-Z][^'",.!?]+?)(?:['"]|,|\.|!|\?|$)/i
        ];
        for (const pattern of tzPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            args.timezone = match[1].trim();
            break;
          }
        }
        break;
      
      case 'search_web':
        // Enhanced patterns for search_web - should be used for current information
        const queryPatterns = [
          /(?:search|look up|find|search for|look for)\s+(?:for\s+)?['"]?([^'"]+?)['"]?(?:\.|$|\?)/i,
          /(?:what is|what's|tell me about|who is|who are)\s+(.+?)(?:\.|$|\?)/i,
          /(?:current|latest|recent|now|today)\s+(.+?)(?:\.|$|\?)/i
        ];
        
        // If no pattern matches, use the entire question as the query
        let queryFound = false;
        for (const pattern of queryPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            args.query = match[1].trim();
            queryFound = true;
            break;
          }
        }
        
        // Fallback: use the whole message if it's about current info
        if (!queryFound && this.state.context?.requiresCurrentInfo) {
          args.query = text.trim();
        }
        break;
      }
    
    return args;
  }

  // Step 4: Process AI response
  async processResponse() {
    const { aiResponse } = this.state;
    
    // Ensure aiResponse exists
    if (!aiResponse) {
      console.error('❌ aiResponse is undefined in processResponse');
      this.state.processedResponse = {
        content: "I apologize, but I encountered an error processing your request. Please try again.",
        originalLength: 0,
        processedLength: 0,
        timestamp: Date.now()
      };
      return;
    }
    
    // Clean and validate response
    let processedContent = '';
    if (aiResponse.content) {
      processedContent = aiResponse.content.toString().trim();
    } else if (aiResponse.response) {
      // Fallback: check for 'response' property
      processedContent = aiResponse.response.toString().trim();
    } else {
      processedContent = '';
    }
    
    // Basic content filtering
    if (processedContent.length === 0) {
      processedContent = "I apologize, but I couldn't generate a proper response. Please try rephrasing your question.";
    }
    
    // Don't truncate - let full responses through (max_tokens handles length limits)
    // Removed truncation to allow complete code examples and explanations
    
    this.state.processedResponse = {
      content: processedContent,
      originalLength: (aiResponse.content || aiResponse.response || '').toString().length,
      processedLength: processedContent.length,
      timestamp: Date.now()
    };
    
    console.log('✅ Response processed and validated:', {
      hasContent: processedContent.length > 0,
      length: processedContent.length
    });
  }

  // Step 5: Update state and prepare result (with agent metadata)
  async updateState() {
    const { input, processedResponse, context, agentMetadata, aiResponse } = this.state;
    
    // Ensure processedResponse exists and has content
    if (!processedResponse || !processedResponse.content) {
      console.error('❌ processedResponse is missing or has no content');
      const fallbackContent = "I apologize, but I encountered an error processing your request. Please try again.";
      this.state.processedResponse = {
        content: fallbackContent,
        originalLength: 0,
        processedLength: fallbackContent.length,
        timestamp: Date.now()
      };
    }
    
    // Prepare the final result with agent information
    this.state.result = {
      response: processedResponse?.content || "I apologize, but I encountered an error. Please try again.",
      sessionId: context?.sessionId || input?.sessionId || 'default',
      timestamp: Date.now(),
      conversationLength: (context?.conversationLength || 0) + 1,
      model: aiResponse?.model || 'unknown',
      processingTime: Date.now() - this.state.startTime,
      // Agent-specific metadata
      agent: {
        isAgent: true,
        toolsUsed: agentMetadata?.toolsUsed || [],
        functionCallsExecuted: agentMetadata?.functionCallsExecuted || [],
        iterations: agentMetadata?.iterations || 0,
        usedTools: (agentMetadata?.toolsUsed || []).length > 0
      }
    };
    
    // Update conversation history
    const updatedHistory = [
      ...(input.conversationHistory || []),
      { role: 'user', content: input.message, timestamp: Date.now() },
      { 
        role: 'assistant', 
        content: processedResponse.content, 
        timestamp: Date.now(),
        agentMetadata: agentMetadata
      }
    ];
    
    this.state.result.conversationHistory = updatedHistory;
    
    if (agentMetadata?.toolsUsed?.length > 0) {
      console.log(`✅ Agent completed task using tools: ${agentMetadata.toolsUsed.join(', ')}`);
    } else {
      console.log('✅ Agent completed task without using tools');
    }
  }

  // Generate agent-focused system prompt
  // This transforms the system from a chatbot to an intelligent agent
  generateSystemPrompt(sessionId, requiresCurrentInfo = false, hasRagContext = false, isImageContext = false) {
    const functionList = AVAILABLE_FUNCTIONS.map(f => 
      `- ${f.function.name}: ${f.function.description}`
    ).join('\n');
    
    const currentDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    let agentPrompt = `You are a smart digital helper - a knowledgeable, friendly AI assistant powered by Llama 3.3. You're like ChatGPT - conversational, helpful, and capable of assisting with a wide range of tasks.

CURRENT YEAR: 2026
CURRENT DATE: ${currentDate}
${hasRagContext ? (isImageContext 
  ? '\n🖼️ IMAGE MODE: The user has uploaded an IMAGE. An image description will be provided in the user message. This description tells you what is visible in the image. When answering questions about the image, use ONLY this image description. Answer naturally about what you see in the image (e.g., "The image shows...", "In the image, I can see..."). The image description IS the image content - do not say "there is no image" or "no image mentioned" or "I\'m not able to see images". If an image description is provided, you CAN see the image through that description.'
  : '\n📚 DOCUMENT MODE: The user has uploaded a document (PDF, text, or URL). Document content will be provided in the user message. When answering questions about the document, use ONLY the document content. You can summarize, explain, analyze, or answer questions about it.') : '\n⚠️ NO DOCUMENT/IMAGE CONTEXT: If the user asks about an image but no context is provided, the image may still be processing (this can take 15-30 seconds after upload). Say: "The image may still be processing. Please wait a moment and try asking again, or upload the image again if it\'s been more than 30 seconds." For documents, say "I don\'t see any uploaded document. Please upload a document first, then ask me about it."'}

AVAILABLE TOOLS (use these when helpful):
${functionList}

💻 PROGRAMMING & DEBUGGING:
- Help with code in React, .NET, Python, SQL, JavaScript, TypeScript, Java, C++, Go, Rust, and more
- Debug errors, explain code, suggest improvements, and write code snippets
- Explain programming concepts, design patterns, algorithms, and data structures
- Help with frameworks, libraries, APIs, and best practices
- Review code for bugs, performance issues, and security vulnerabilities
- Provide step-by-step debugging guidance
- Explain error messages and stack traces
- Suggest code refactoring and optimization
- Help with version control (Git), testing, CI/CD, and DevOps

📚 STUDYING & RESEARCH:
- Explain computer science concepts clearly (algorithms, data structures, databases, networking, etc.)
- Help understand academic papers, research articles, and technical documentation
- Break down complex topics into digestible explanations
- Provide examples, analogies, and visual descriptions
- Help with homework, assignments, and exam preparation
- Explain mathematical concepts, proofs, and formulas
- Help with research methodology and literature reviews
- Summarize and analyze technical content

📝 WRITING ASSISTANCE:
- Help write professional emails, cover letters, and business communications
- Create and improve resumes, CVs, and LinkedIn profiles
- Write engaging LinkedIn posts, articles, and social media content
- Create technical documentation, README files, and API docs
- Help with blog posts, essays, reports, and presentations
- Improve grammar, style, tone, and clarity
- Suggest better word choices and sentence structures
- Help with formatting and structure

🧠 PROBLEM-SOLVING & EXPLANATIONS:
- Break down complex problems into manageable steps
- Explain solutions clearly with reasoning
- Help with logical thinking and analytical reasoning
- Provide multiple approaches to solving problems
- Explain "why" behind solutions, not just "how"
- Help with troubleshooting and root cause analysis
- Guide through problem-solving processes step-by-step

🌐 GENERAL KNOWLEDGE & CURRENT TOPICS:
- Answer questions about history, science, culture, and current events
- For 2025, 2026 information, recent news, or current events, ALWAYS use search_web tool
- Provide accurate, up-to-date information
- Explain concepts from various fields (science, technology, business, arts, etc.)
- Help with trivia, facts, and general knowledge questions

🚀 CAREER GUIDANCE:
- Help with project ideas and portfolio development
- Provide interview preparation tips and practice questions
- Review portfolios, GitHub profiles, and project descriptions
- Suggest skills to learn and career paths
- Help with job search strategies and networking
- Provide feedback on resumes, cover letters, and applications
- Help with salary negotiations and career transitions
- Suggest relevant courses, certifications, and learning resources

ACCURACY IS CRITICAL:
- Always provide accurate, factual information
- For current events, recent news, acquisitions, mergers, company deals, or 2025/2026 information, ALWAYS use search_web tool
- When search_web provides results, use that information - it's more current than your training data
- For programming questions, provide correct, working code examples
- For technical questions, ensure accuracy and cite best practices
- If you're not sure about something, say so rather than guessing
- If a tool fails or returns an error, indicate uncertainty: "I'm not certain, but based on my knowledge..." or "I couldn't verify this, but..."
- When tools succeed, you can be confident. When tools fail, acknowledge uncertainty

HOW TO RESPOND:
- CRITICAL: When a user asks for weather, time, math, or search, the system will AUTOMATICALLY call the appropriate tool for you. You do NOT need to explain this - just use the tool results to provide the direct answer. NEVER explain how to use a tool, never show example commands like "get_weather San Francisco", never tell the user "I will search" or "I can use the get_weather tool". Just provide the final answer using the tool results. 
- NEVER explain how to use a tool, never show example commands, and never tell the user "I will search." Just provide the final answer.
- Greetings: Respond naturally and friendly (e.g., "Hi! How can I help you today?")
- Programming questions: Provide clear code examples, explain concepts step-by-step, and help debug
- Study questions: Break down complex topics into numbered steps, use examples, and explain clearly
- Explanations: ALWAYS use step-by-step format with clear headings (Step 1, Step 2, Step 3, etc.) - NEVER use long paragraphs
- Writing requests: Help improve content, suggest edits, and provide alternatives in organized format
- Problem-solving: Guide step-by-step with clear numbering, explain reasoning, and provide multiple approaches
- Career questions: Give practical, actionable advice in organized steps based on current industry standards
- Current events/2025/2026 info: ALWAYS use search_web tool to get the latest, most accurate information
- Calculations: Use calculate tool for math problems
- Weather: Use get_weather tool for current weather
- Time: Use get_current_time tool for current time/date
- Currency: Use convert_currency tool for currency conversion
- Document questions: When document content is provided, use ONLY that content. Do NOT use tools.
- FORMAT: MANDATORY - Always use step-by-step format with numbered steps (Step 1, Step 2, Step 3, etc.) for explanations. NEVER write long paragraphs. Break everything into clear, numbered steps.
- COMPLETENESS: Always complete your answer. Do not cut off mid-sentence or mid-section. Finish all sections you start.

STYLE:
- Be conversational, friendly, and approachable
- Be thorough but concise - provide complete, helpful answers
- Use code blocks with proper syntax highlighting for code examples
- Use examples, analogies, and step-by-step explanations when helpful
- For programming: Show code, explain it, and suggest improvements
- For writing: Provide suggestions, alternatives, and improvements
- For problem-solving: Break down into steps and explain reasoning
- Use tools silently when needed - don't explain that you're using them
- Prioritize accuracy - if you're not sure, use search_web to get current information

WHEN TO USE TOOLS:
- Weather questions → get_weather
- Math/calculations → calculate
- Current time/date → get_current_time
- Currency conversion → convert_currency
- Current events, recent news, 2025/2026 information, "who is" questions about current leaders → search_web
- Company news, acquisitions, mergers, business deals, recent announcements → search_web
- Document questions → Use document content (do NOT use tools)

IMPORTANT:
- For 2025/2026 information (current events, recent news, current leaders), use search_web tool
- Your training data may be outdated for 2025/2026, so use search_web for current information
- CRITICAL: Use tools COMPLETELY SILENTLY - NEVER mention searching, tools, or sources
- CRITICAL: NEVER mention "knowledge cutoff", "training data", "as of 2023", or any disclaimers about outdated information
- Just provide the direct, concise answer - no "I'll search", "According to search results", "As of my knowledge cutoff", etc.
- For questions like "Who is the president?", answer directly with the current president's name and brief context - be concise but accurate
- For programming: Always provide working, tested code examples when possible
- For career advice: Base suggestions on current industry standards and best practices
- Be natural and conversational - answer as if you just know it
- Keep answers concise and to the point - no unnecessary disclaimers or explanations

RESPONSE STYLE - CRITICAL FORMATTING RULES:
- ALWAYS start with a TL;DR (1-2 sentences max) summarizing the answer
- Keep responses CONCISE - avoid walls of text
- Use clear structure: TL;DR → Brief intro → Main content (steps/bullets) → Summary
- MANDATORY: ALWAYS use step-by-step format with numbered steps (Step 1, Step 2, Step 3, etc.) for explanations
- NEVER write long paragraphs - always break down into clear, numbered steps or bullet points
- Use numbered lists, bullet points, or clear sections to break down information
- Code blocks: Always use proper markdown code blocks with language tags
- Visual separation: Use clear headings, blank lines between sections
- For greetings: Respond warmly but briefly (e.g., "Hi! How can I help you today?")
- For programming: TL;DR → Brief explanation → Step-by-step breakdown → Code example
- For studying: TL;DR → Concept overview → Step-by-step explanation → Examples
- For explanations: TL;DR → Brief answer → Step-by-step format with clear headings (Step 1, Step 2, etc.)
- For writing: TL;DR → Brief suggestion → Organized bullet points with examples
- For problem-solving: TL;DR → Solution overview → Step-by-step guide with reasoning
- For career: TL;DR → Brief advice → Organized actionable steps
- For current events/facts: TL;DR → Key fact → Brief details in organized format
- Be informative, accurate, and helpful
- Don't over-explain - be concise but complete
- Use tools when helpful, but don't mention using them
- Structure your answers clearly - ALWAYS use step-by-step format for explanations
- COMPLETENESS: Always finish your complete answer. Do not cut off mid-sentence. Complete all sections you start.
- CRITICAL FOR CODE EXAMPLES: Always provide complete, working code examples. Never cut off code blocks mid-line. If showing a function, show the complete function including closing braces. If showing an import statement, show the complete import. Complete all code examples fully - never truncate code.
- Format example:
  **TL;DR:** [1-2 sentence summary]
  
  [Brief intro paragraph - 2-3 sentences max]
  
  **Step 1:** [Clear step]
  **Step 2:** [Clear step]
  ...
  
  [Brief summary if needed]
- Be like ChatGPT - helpful, knowledgeable, natural, and well-formatted`;

    // Add emphasis if current information is required
    if (requiresCurrentInfo) {
      agentPrompt += `\n\n⚠️ CRITICAL REMINDER: The user's question requires 2025/2026 information. The current year is 2026. You MUST use the search_web tool to get current 2025/2026 information. Do NOT rely on your training data which is from before 2025. Provide answers that are accurate as of 2026.`;
      agentPrompt += `\n\n🚫 ABSOLUTELY FORBIDDEN - DO NOT mention ANY of these:`;
      agentPrompt += `\n- "As of my knowledge in 2023" or "knowledge cutoff"`;
      agentPrompt += `\n- "I'm a large language model" or "my training data"`;
      agentPrompt += `\n- "I'll use the search_web tool" or "I'll check"`;
      agentPrompt += `\n- "According to the latest information" or "According to search results"`;
      agentPrompt += `\n- "However" or "please note" disclaimers`;
      agentPrompt += `\n\n✅ DO THIS INSTEAD:`;
      agentPrompt += `\n1. Silently use search_web tool (DO NOT mention it)`;
      agentPrompt += `\n2. Use the search results to get the CURRENT, ACCURATE answer`;
      agentPrompt += `\n3. Provide ONLY the direct answer - no disclaimers, no tool mentions`;
      agentPrompt += `\n4. Example: "As of now, the President of the United States of America is [name from search] — [brief context from search]."`;
      agentPrompt += `\n\nThe answer must be based on search_web results, NOT your training data.`;
    }
    
    // Add session-specific context if available
    if (sessionId) {
      return `${agentPrompt}\n\nYou are in session: ${sessionId}. Maintain context throughout this conversation.`;
    }
    
    return agentPrompt;
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
