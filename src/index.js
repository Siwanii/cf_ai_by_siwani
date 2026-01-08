// main worker file
// handles all the api endpoints and routes requests


import { ChatSession } from './chat-session.js';
import { ChatWorkflow } from './workflow.js';
import { processDocument, similaritySearch, queryByDocumentId } from './rag.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers - I set these pretty permissive for development, you'd want to lock
    // this down in production
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight 
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

  // Route requests to the right handler - simple switch statement, nothing fancy
    switch (path) {

      case '/':
    return new Response(`<h1>Welcome to AI Agent</h1>
<p>Intelligent agent with function calling capabilities.</p>
<p>Use <code>/api/chat</code> endpoint to interact with the agent.</p>`, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html' }
    });
    
      case '/api/chat':
        const url = new URL(request.url);
        const stream = url.searchParams.get('stream') === 'true';
        return this.handleChatRequest(request, env, corsHeaders, stream);
      
      case '/api/upload':
        return this.handleDocumentUpload(request, env, corsHeaders);
      
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
      const { message, sessionId, conversationHistory = [], lastImageDocumentId } = await request.json();

      if (!message) {
        return new Response(JSON.stringify({ error: 'Message is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get the chat session - Durable Objects are Cloudflare's way of keeping state
      // between requests, which is perfect for conversation history
      const durableObjectId = env.CHAT_SESSION.idFromName(sessionId || 'default');
      const durableObject = env.CHAT_SESSION.get(durableObjectId);

      // Build up the conversation history so the AI remembers what we talked about
      const messages = conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Add current user message
      messages.push({
        role: 'user',
        content: message
      });

      // Check if they're asking about a document they uploaded - if so, search for
      // relevant chunks in Vectorize. I made it smart enough to not search on
      // simple greetings, which was annoying before
      let ragContext = '';
      try {
        // Detect document-related requests (summarize, explain, analyze, etc.)
        // IMPORTANT: Don't search for documents on simple greetings or casual messages
        const lowerMessage = message.toLowerCase().trim();
        const isGreeting = lowerMessage === 'hi' || 
                          lowerMessage === 'hello' || 
                          lowerMessage === 'hey' ||
                          lowerMessage.startsWith('hi ') ||
                          lowerMessage.startsWith('hello ') ||
                          lowerMessage.startsWith('hey ');
        
        // Detect if this is a document-related request
        // Only trigger RAG if user explicitly mentions documents/files OR if they use action words that imply document content
        const hasDocumentKeywords = lowerMessage.includes('document') || 
                                   lowerMessage.includes('pdf') || 
                                   lowerMessage.includes('file') ||
                                   lowerMessage.includes('text') ||
                                   lowerMessage.includes('link') ||
                                   lowerMessage.includes('url') ||
                                   lowerMessage.includes('image') ||
                                   lowerMessage.includes('picture') ||
                                   lowerMessage.includes('photo') ||
                                   lowerMessage.includes('resume') ||
                                   lowerMessage.includes('cv') ||
                                   lowerMessage.includes('uploaded') ||
                                   lowerMessage.includes('attached');
        
      const hasDocumentActionWords = lowerMessage.includes('summarize') || 
                                   lowerMessage.includes('summary') ||
                                   lowerMessage.includes('explain') ||
                                   lowerMessage.includes('analyze') ||
                                   lowerMessage.includes('review') ||
                                   lowerMessage.includes('what does it say') ||
                                   lowerMessage.includes('what is this about') ||
                                   lowerMessage.includes('tell me about') ||
                                   lowerMessage.includes('describe') ||
                                   lowerMessage.includes('what is in') ||
                                   lowerMessage.includes('what do you see') ||
                                   lowerMessage.includes('what is this') ||
                                   lowerMessage === 'explain' || // Catch exact matches
                                   lowerMessage === 'explain?';
        
        // Only do RAG search if user mentions documents/files OR if they use action words WITH document keywords or context words
        // This prevents RAG search for general knowledge questions like "explain how quicksort works"
        // IMPORTANT: For image queries, ALWAYS trigger RAG search to find uploaded images
        const isImageQueryForRAG = lowerMessage.includes('image') || 
                                   lowerMessage.includes('picture') || 
                                   lowerMessage.includes('photo') ||
                                   lowerMessage.includes('what\'s there in') ||
                                   lowerMessage.includes('what is there in') ||
                                   lowerMessage.includes('what\'s in') ||
                                   lowerMessage.includes('what is in') ||
                                   lowerMessage.includes('what\'s this') ||
                                   lowerMessage.includes('what is this') ||
                                   lowerMessage.includes('what do you see');
        
        const isDocumentRequest = !isGreeting && (
          hasDocumentKeywords || // Trigger if they say "PDF", "Document", "Image", etc.
          isImageQueryForRAG || // ALWAYS trigger RAG for image queries
          (hasDocumentActionWords && lowerMessage.length < 20) || // Trigger if they just say "Explain?" or "What's this?"
          (hasDocumentActionWords && (
              lowerMessage.includes('this') || 
              lowerMessage.includes('it') || 
              lowerMessage.includes('the document') ||
              lowerMessage.includes('the file') ||
              lowerMessage.includes('the pdf') ||
              lowerMessage.includes('the image') ||
              lowerMessage.includes('the photo') ||
              lowerMessage.includes('my resume') ||
              lowerMessage.includes('my cv')
          ))
      );
        
        // Only search for documents if it's a document-related request (not a greeting)
        if (isDocumentRequest) {
          // For document requests, use a broad search to get all relevant content
          // Try multiple search strategies to get comprehensive context
          let allChunks = [];
          
          // For summarize/explain requests, use generic queries that will match document content
          const isSummaryOrExplain = lowerMessage.includes('summarize') || 
                                     lowerMessage.includes('summary') || 
                                     lowerMessage.includes('explain') ||
                                     lowerMessage.includes('analyze') ||
                                     lowerMessage.includes('what does it say') ||
                                     lowerMessage.includes('what is this about') ||
                                     lowerMessage.includes('tell me about') ||
                                     lowerMessage.includes('describe') ||
                                     lowerMessage.includes('what is in') ||
                                     lowerMessage.includes('what do you see');
          
          if (isSummaryOrExplain) {
            // Strategy 1: Use very generic queries that will match any document/image content
            // These queries are designed to retrieve chunks from uploaded documents and images
            const genericQueries = [
              'document content information text data',
              'the document text content',
              'information content text',
              'document information',
              'image description content',
              'image analysis description',
              'visual content description',
              'picture description content',
              '[IMAGE DESCRIPTION]', // Direct search for image descriptions
              'image shows',
              'image contains',
              'in the image',
              'the image',
              'picture shows',
              'photo shows'
            ];
            
            for (const query of genericQueries) {
              const chunks = await similaritySearch(query, env, 25);
              if (chunks && chunks.length > 0) {
                allChunks.push(...chunks);
              }
            }
            
            // Strategy 2: If user's message has specific terms (not just "summarize"), also search with those
            // Remove common action words to get content-related terms
            const contentTerms = message
              .toLowerCase()
              .replace(/\b(summarize|summary|explain|analyze|what|about|tell|me|this|the|document|pdf|file|text|link|url|image|picture|photo|see|describe)\b/gi, '')
              .trim();
            
            if (contentTerms.length > 3) {
              const specificChunks = await similaritySearch(contentTerms, env, 15);
              if (specificChunks && specificChunks.length > 0) {
                allChunks.push(...specificChunks);
              }
            }
          } else {
            // For other document questions, use the user's message as query
            const messageChunks = await similaritySearch(message, env, 20);
            if (messageChunks && messageChunks.length > 0) {
              allChunks.push(...messageChunks);
            }
            
            // Also try generic search as fallback
            const genericChunks = await similaritySearch('document content information', env, 15);
            if (genericChunks && genericChunks.length > 0) {
              allChunks.push(...genericChunks);
            }
          }
          
          // Remove duplicates by ID and sort by score
          const chunkMap = new Map();
          for (const chunk of allChunks) {
            const chunkId = chunk.id || chunk.metadata?.id || `${chunk.metadata?.documentId}-${chunk.metadata?.chunkIndex}` || Math.random().toString();
            if (!chunkMap.has(chunkId) || (chunk.score || 0) > (chunkMap.get(chunkId).score || 0)) {
              chunkMap.set(chunkId, chunk);
            }
          }
          
          const uniqueChunks = Array.from(chunkMap.values());
          
          // Group chunks by document ID to prioritize most recent document
          const chunksByDocument = new Map();
          for (const chunk of uniqueChunks) {
            const docId = chunk.metadata?.documentId || 'unknown';
            if (!chunksByDocument.has(docId)) {
              chunksByDocument.set(docId, []);
            }
            chunksByDocument.get(docId).push(chunk);
          }
          
          // Helper function to extract timestamp from documentId (format: image-{timestamp}-{random})
          const extractTimestampFromDocId = (docId) => {
            if (!docId) return 0;
            // Try metadata timestamp first
            // If not available, extract from documentId format: {type}-{timestamp}-{random}
            const match = docId.match(/-(\d+)-/);
            if (match) {
              return parseInt(match[1], 10);
            }
            return 0;
          };
          
          // Find the most recent document (highest timestamp)
          // Use both metadata timestamp and documentId timestamp for better accuracy
          let mostRecentDocId = null;
          let mostRecentTimestamp = 0;
          for (const [docId, chunks] of chunksByDocument.entries()) {
            // Get max timestamp from metadata
            const maxMetadataTimestamp = Math.max(...chunks.map(c => c.metadata?.timestamp || 0));
            // Get timestamp from documentId (for old documents without metadata timestamp)
            const docIdTimestamp = extractTimestampFromDocId(docId);
            // Use the maximum of both
            const maxTimestamp = Math.max(maxMetadataTimestamp, docIdTimestamp);
            
            if (maxTimestamp > mostRecentTimestamp) {
              mostRecentTimestamp = maxTimestamp;
              mostRecentDocId = docId;
            }
          }
          
          // Check if we're dealing with images - ONLY based on user's message, NOT search results
          // This prevents treating regular questions as image queries just because image chunks were found
          const isImageQuery = lowerMessage.includes('image') || 
                              lowerMessage.includes('picture') || 
                              lowerMessage.includes('photo') ||
                              lowerMessage.includes('what do you see') ||
                              lowerMessage.includes('what\'s there in') ||
                              lowerMessage.includes('what is there in') ||
                              lowerMessage.includes('what\'s in') ||
                              lowerMessage.includes('what is in') ||
                              lowerMessage.includes('what\'s this') ||
                              lowerMessage.includes('what is this') ||
                             (lowerMessage.includes('describe') && (lowerMessage.includes('image') || 
                              lowerMessage.includes('picture') || 
                              lowerMessage.includes('photo'))) ||
                              (hasDocumentActionWords && (lowerMessage.includes('image') || lowerMessage.includes('picture') || lowerMessage.includes('photo')));
          
          // For image queries, find ALL image documents and get the most recent one
          let mostRecentImageDocId = null;
          let mostRecentImageTimestamp = 0;
          if (isImageQuery) {
            for (const [docId, chunks] of chunksByDocument.entries()) {
              // Check if this is an image document
              const isImageDoc = chunks.some(c => c.text?.includes('[IMAGE DESCRIPTION]'));
              if (isImageDoc) {
                const maxMetadataTimestamp = Math.max(...chunks.map(c => c.metadata?.timestamp || 0));
                const docIdTimestamp = extractTimestampFromDocId(docId);
                const maxTimestamp = Math.max(maxMetadataTimestamp, docIdTimestamp);
                
                if (maxTimestamp > mostRecentImageTimestamp) {
                  mostRecentImageTimestamp = maxTimestamp;
                  mostRecentImageDocId = docId;
                }
              }
            }
          }
          
          // Sort chunks: prioritize chunks from most recent document, then by score
          let sortedChunks = uniqueChunks
            .sort((a, b) => {
              const aIsRecent = a.metadata?.documentId === mostRecentDocId;
              const bIsRecent = b.metadata?.documentId === mostRecentDocId;
              const aIsImage = a.text?.includes('[IMAGE DESCRIPTION]');
              const bIsImage = b.text?.includes('[IMAGE DESCRIPTION]');
              
              // For image queries, ALWAYS prioritize most recent image over old ones
              if (isImageQuery && aIsImage && bIsImage) {
                const aIsRecentImage = a.metadata?.documentId === mostRecentImageDocId;
                const bIsRecentImage = b.metadata?.documentId === mostRecentImageDocId;
                
                if (aIsRecentImage && !bIsRecentImage) return -1; // Recent image always wins
                if (!aIsRecentImage && bIsRecentImage) return 1;  // Recent image always wins
                
                // If both are recent or both are old, use timestamp
                const aTimestamp = a.metadata?.timestamp || extractTimestampFromDocId(a.metadata?.documentId);
                const bTimestamp = b.metadata?.timestamp || extractTimestampFromDocId(b.metadata?.documentId);
                return bTimestamp - aTimestamp;
              }
              
              // For non-image queries or mixed content, use standard prioritization
              // If one is from recent doc and other isn't, prioritize recent
              if (aIsRecent && !bIsRecent) return -1;
              if (!aIsRecent && bIsRecent) return 1;
              
              // If both from same doc (or both not recent), sort by score
              const scoreDiff = (b.score || 0) - (a.score || 0);
              if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
              
              // If scores are close, prefer newer timestamp
              const aTimestamp = a.metadata?.timestamp || extractTimestampFromDocId(a.metadata?.documentId);
              const bTimestamp = b.metadata?.timestamp || extractTimestampFromDocId(b.metadata?.documentId);
              return bTimestamp - aTimestamp;
            })
            .slice(0, 30); // Get top 30 chunks for comprehensive context
          
          // For NON-IMAGE queries, EXCLUDE image chunks from results BEFORE processing
          // This prevents AI from explaining images when user asks regular questions
          if (!isImageQuery) {
            const imageChunksCount = sortedChunks.filter(c => c.text?.includes('[IMAGE DESCRIPTION]')).length;
            if (imageChunksCount > 0) {
              sortedChunks = sortedChunks.filter(c => !c.text?.includes('[IMAGE DESCRIPTION]'));
            }
          }
          
          let finalChunks = sortedChunks;
          if (isImageQuery) {
            // Query Vectorize directly with generic queries to get ALL image chunks
            // This bypasses similarity score filtering and ensures we find ALL images in the database
            const imageSearchQueries = [
              '[IMAGE DESCRIPTION]',
              'image description',
              'image shows',
              'picture shows',
              'photo shows',
              'visual content',
              'image contains'
            ];
            
            let allImageChunksFromDB = [];
            for (const query of imageSearchQueries) {
              try {
                // Use a large topK to get as many image chunks as possible
                const chunks = await similaritySearch(query, env, 100);
                const imageChunks = chunks.filter(c => c.text?.includes('[IMAGE DESCRIPTION]'));
                allImageChunksFromDB.push(...imageChunks);
              } catch (err) {
                // Continue to next query
              }
            }
            
            // Remove duplicates by chunk ID
            const imageChunkMap = new Map();
            for (const chunk of allImageChunksFromDB) {
              const chunkId = chunk.id || chunk.metadata?.id || `${chunk.metadata?.documentId}-${chunk.metadata?.chunkIndex}`;
              if (!imageChunkMap.has(chunkId)) {
                imageChunkMap.set(chunkId, chunk);
              }
            }
            const allImageChunks = Array.from(imageChunkMap.values());
            
            if (allImageChunks.length > 0) {
              // Group image chunks by document ID
              const imageDocs = new Map();
              for (const chunk of allImageChunks) {
                const docId = chunk.metadata?.documentId || 'unknown';
                if (!imageDocs.has(docId)) {
                  // Get timestamp from metadata (preferred) or extract from documentId
                  const metadataTimestamp = chunk.metadata?.timestamp || 0;
                  const docIdTimestamp = extractTimestampFromDocId(docId);
                  // Use the maximum of both for most accurate timestamp
                  const maxTimestamp = Math.max(metadataTimestamp, docIdTimestamp);
                  imageDocs.set(docId, { timestamp: maxTimestamp, chunks: [] });
                }
                imageDocs.get(docId).chunks.push(chunk);
              }
              
              // Find the document with the highest timestamp (most recent)
              let bestDocId = null;
              let bestTimestamp = 0;
              const allImageDocs = [];
              for (const [docId, data] of imageDocs.entries()) {
                allImageDocs.push({ docId, timestamp: data.timestamp, chunkCount: data.chunks.length });
                if (data.timestamp > bestTimestamp) {
                  bestTimestamp = data.timestamp;
                  bestDocId = docId;
                }
              }
              
              allImageDocs.sort((a, b) => b.timestamp - a.timestamp);
              
              if (bestDocId && imageDocs.has(bestDocId)) {
                finalChunks = imageDocs.get(bestDocId).chunks;
                
                finalChunks = finalChunks.filter(chunk => {
                  const chunkDocId = chunk.metadata?.documentId || 'unknown';
                  return chunkDocId === bestDocId;
                });
                
                const uniqueDocIds = [...new Set(finalChunks.map(c => c.metadata?.documentId || 'unknown'))];
                if (uniqueDocIds.length > 1) {
                  console.error(`Error: finalChunks contains chunks from multiple documents: ${uniqueDocIds.join(', ')}`);
                  finalChunks = finalChunks.filter(c => (c.metadata?.documentId || 'unknown') === bestDocId);
                }
              } else {
                if (mostRecentImageDocId) {
                  const recentChunks = allImageChunks.filter(c => c.metadata?.documentId === mostRecentImageDocId);
                  if (recentChunks.length > 0) {
                    finalChunks = recentChunks;
                  } else {
                    if (allImageDocs.length > 0) {
                      const newestDoc = allImageDocs[0];
                      finalChunks = imageDocs.get(newestDoc.docId)?.chunks || [allImageChunks[0]];
                    } else {
                      finalChunks = [allImageChunks[0]];
                    }
                  }
                } else {
                  if (allImageDocs.length > 0) {
                    const newestDoc = allImageDocs[0];
                    finalChunks = imageDocs.get(newestDoc.docId)?.chunks || [allImageChunks[0]];
                  } else {
                    finalChunks = [allImageChunks[0]];
                  }
                }
              }
            } else {
              
              // RACE CONDITION FIX: Try querying by document ID with retries
              // This handles the case where the image was just uploaded and Vectorize is still indexing
              // Priority: 1) lastImageDocumentId from frontend, 2) mostRecentImageDocId from search, 3) timestamp-based search
              const documentIdToQuery = lastImageDocumentId || mostRecentImageDocId;
              
              if (documentIdToQuery) {
              const documentChunks = await queryByDocumentId(documentIdToQuery, env, 3, 500);
              if (documentChunks.length > 0) {
                finalChunks = documentChunks;
              } else {
                const fallbackImageChunks = uniqueChunks.filter(c => c.text?.includes('[IMAGE DESCRIPTION]'));
                if (fallbackImageChunks.length > 0) {
                  finalChunks = fallbackImageChunks;
                } else {
                  ragContext = '[IMAGE_PROCESSING] The image was uploaded but is still being processed by the system. This usually takes 15-30 seconds. Please wait a moment and try asking again.';
                }
              }
              } else {
                // Try to find the most recent image document ID by querying with recent timestamps
                // Document ID format: image-{timestamp}-{random}
                // Try querying with timestamps from the last 2 minutes (in case image was just uploaded)
                const now = Date.now();
                const recentTimestamps = [];
                for (let i = 0; i < 24; i++) { // Try last 2 minutes in 5-second intervals
                  recentTimestamps.push(now - (i * 5000));
                }
                
                let foundRecentDoc = false;
                for (const timestamp of recentTimestamps) {
                  // Try document ID pattern: image-{timestamp}-*
                  // We'll query with a generic search and filter by timestamp in metadata
                  try {
                    const testChunks = await similaritySearch('[IMAGE DESCRIPTION]', env, 50);
                    const recentImageChunks = testChunks.filter(c => {
                      const chunkTimestamp = c.metadata?.timestamp || extractTimestampFromDocId(c.metadata?.documentId || '');
                      // Check if timestamp is within 2 minutes
                      return Math.abs(chunkTimestamp - timestamp) < 120000; // 2 minutes
                    });
                    
                    if (recentImageChunks.length > 0) {
                      // Group by document ID and find most recent
                      const recentDocs = new Map();
                      for (const chunk of recentImageChunks) {
                        const docId = chunk.metadata?.documentId || 'unknown';
                        if (!recentDocs.has(docId)) {
                          const metaTs = chunk.metadata?.timestamp || 0;
                          const docIdTs = extractTimestampFromDocId(docId);
                          recentDocs.set(docId, Math.max(metaTs, docIdTs));
                        }
                      }
                      
                      // Get the most recent document ID
                      let bestDocId = null;
                      let bestTimestamp = 0;
                      for (const [docId, ts] of recentDocs.entries()) {
                        if (ts > bestTimestamp) {
                          bestTimestamp = ts;
                          bestDocId = docId;
                        }
                      }
                      
                      if (bestDocId) {
                        const documentChunks = await queryByDocumentId(bestDocId, env, 2, 1000);
                        if (documentChunks.length > 0) {
                          finalChunks = documentChunks;
                          foundRecentDoc = true;
                          break;
                        }
                      }
                    }
                  } catch (err) {
                    // Continue to next timestamp
                    continue;
                  }
                }
                
                if (!foundRecentDoc) {
                  const fallbackImageChunks = uniqueChunks.filter(c => c.text?.includes('[IMAGE DESCRIPTION]'));
                  if (fallbackImageChunks.length > 0) {
                    finalChunks = fallbackImageChunks;
                  }
                }
              }
            }
          }
          
          if (finalChunks.length > 0) {
            // FINAL SAFETY CHECK: For image queries, ensure we only have chunks from ONE document
            if (isImageQuery) {
              const uniqueDocIds = [...new Set(finalChunks.map(c => c.metadata?.documentId || 'unknown'))];
              if (uniqueDocIds.length > 1) {
                console.error(`Error: finalChunks contains chunks from ${uniqueDocIds.length} different documents: ${uniqueDocIds.join(', ')}`);
                let mostRecentDocId = null;
                let mostRecentTimestamp = 0;
                for (const docId of uniqueDocIds) {
                  const docChunks = finalChunks.filter(c => (c.metadata?.documentId || 'unknown') === docId);
                  const maxTimestamp = Math.max(...docChunks.map(c => {
                    const metaTs = c.metadata?.timestamp || 0;
                    const docIdTs = extractTimestampFromDocId(docId);
                    return Math.max(metaTs, docIdTs);
                  }));
                  if (maxTimestamp > mostRecentTimestamp) {
                    mostRecentTimestamp = maxTimestamp;
                    mostRecentDocId = docId;
                  }
                }
                if (mostRecentDocId) {
                  finalChunks = finalChunks.filter(c => (c.metadata?.documentId || 'unknown') === mostRecentDocId);
                }
              }
            }
            
            ragContext = finalChunks
              .map(chunk => chunk.text)
              .join('\n\n---\n\n');
            const docIds = [...new Set(finalChunks.map(c => c.metadata?.documentId || 'unknown'))];
            if (isImageQuery && docIds.length > 1) {
              console.error(`Error: Multiple document IDs found in finalChunks for image query: ${docIds.join(', ')}`);
            }
          } else {
            if (hasDocumentKeywords) {
              console.warn('No document chunks found. Document may still be processing or search failed.');
            }
          }
        }
        // Don't search for documents on greetings or casual messages - only on explicit document requests
      } catch (error) {
        console.warn('RAG search failed, continuing without context:', error);
      }

      // Use workflow to process the chat request
      // Add timeout to prevent 504 Gateway Timeout errors
     const workflow = new ChatWorkflow();
      await workflow.defineWorkflow(); // Initialize the workflow steps
      const workflowPromise = workflow.execute({
        message,
        sessionId: sessionId || 'default',
        conversationHistory,
        ragContext: ragContext // Pass RAG context to workflow
      }, env);
      
      // Set a timeout of 45 seconds (Cloudflare Workers have a 60s limit for free tier)
      // Reduced from 50s to account for retry logic overhead
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout: The AI is taking too long to respond. Please try simplifying your question or try again.')), 45000);
      });
      
      const result = await Promise.race([workflowPromise, timeoutPromise]);

      // Validate result before sending
      if (!result || !result.response) {
        console.error('❌ Invalid result from workflow:', result);
        return new Response(JSON.stringify({
          error: 'Invalid response from AI agent',
          details: 'The agent workflow did not return a valid response',
          response: "I apologize, but I encountered an error processing your request. Please try again."
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Ensure response is a valid string
      const responseText = typeof result.response === 'string' 
        ? result.response 
        : String(result.response || "I apologize, but I couldn't generate a response. Please try again.");

      // Store the conversation in Durable Object
      try {
      await durableObject.fetch('http://internal/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sessionId || 'default',
            messages: result.conversationHistory || []
        })
      });
      } catch (storageError) {
        console.warn('⚠️ Failed to store conversation:', storageError);
        // Continue even if storage fails
      }

      // Calculate confidence based on tool execution
      const agentMetadata = result.agent || { isAgent: true, toolsUsed: [], usedTools: false };
      const confidence = agentMetadata.usedTools ? 'high' : 'high'; // Can be enhanced based on tool results

      return new Response(JSON.stringify({
        response: responseText,
        sessionId: result.sessionId || sessionId || 'default',
        timestamp: result.timestamp || Date.now(),
        conversationLength: result.conversationLength || 0,
        model: result.model || 'unknown',
        processingTime: result.processingTime || 0,
        confidence: confidence, // Add confidence indicator
        // Agent metadata
        agent: {
          ...agentMetadata,
          confidence: confidence
        }
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        }
      });

    } catch (error) {
      console.error('Chat request error:', error);
      
      // Check if it's an authentication error
      const errorMessage = error.message || String(error);
      const isAuthError = errorMessage.includes('Not logged in') || 
                         errorMessage.includes('not logged in') ||
                         errorMessage.includes('authentication') ||
                         errorMessage.includes('login');
      
      if (isAuthError) {
        return new Response(JSON.stringify({ 
          error: 'Authentication required',
          details: 'Cloudflare authentication is required. Please run: wrangler login',
          response: `I apologize, but I'm unable to process your request because Cloudflare authentication is required.

To fix this, please run:
1. \`wrangler login\` to authenticate with Cloudflare
2. Or ensure you're logged in with: \`wrangler whoami\`

This is required to use Cloudflare Workers AI. Once authenticated, I'll be able to help you!`
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
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
       const currentDate = new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
         });
    
    const systemPrompt = `You are a helpful AI assistant with access to web search capabilities. Today's date is ${currentDate}.

**CRITICAL KNOWLEDGE UPDATE (2026)**:
- Donald Trump is the current President of the United States (inaugurated January 20, 2025)
- He won the 2024 presidential election
- Joe Biden was President from 2021-2025 (previous administration)

**IMPORTANT - Using Current Information**:
- Your training data has a knowledge cutoff and does NOT include events after mid-2024
- For questions about current events, recent news, current world leaders, or anything that may have changed recently, you MUST use the web_search tool
- When users ask about "current president", "who is president now", or similar questions about 2025-2026, use the information above OR the web_search tool for verification
- Examples that REQUIRE web search: "Latest news?", "Current weather", "Recent events", "Who won yesterday's game?", "What happened today?"

**When to use web_search tool**:
1. Current events or breaking news
2. Recent changes in leadership, politics, or government (for verification beyond what's stated above)
3. Sports scores, weather, stock prices
4. Any question with words like: "latest", "recent", "today", "now", "current" (when asking about things that change frequently)
5. When you need to verify information beyond your training data

**When NOT to use web_search**:
1. Historical facts (before 2024) - you already know these
2. General knowledge that doesn't change (like "What is photosynthesis?")
3. User asks about uploaded documents (use document context from RAG instead)
4. Math, coding, or logic problems
5. Questions about current president/leadership where the information is already provided above

Be friendly, informative, and helpful. Keep your responses concise but engaging.
If asked about the current president, you can confidently answer based on the information above.
Always cite sources when using web search results.`;
  
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

  async handleDocumentUpload(request, env, corsHeaders) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { 
        status: 405, 
        headers: corsHeaders 
      });
    }

    // Debug: Check Vectorize binding availability
    const hasVectorize = !!(env.VECTORIZE || env.vectorize || env.Vectorize);
    if (!hasVectorize) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Vectorize binding not available',
        message: 'The Vectorize binding is not available in the current environment.',
        details: 'This usually means the dev server is running in local mode (--local flag) or the binding is not properly configured.',
        suggestion: 'Please restart the dev server WITHOUT the --local flag:\n1. Stop the server (Ctrl+C)\n2. Run: npm run dev\n3. Make sure wrangler.toml has the Vectorize binding configured'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    try {
      const formData = await request.formData();
      const url = formData.get('url');
      const file = formData.get('file');

      if (!url && !file) {
        return new Response(JSON.stringify({ 
          error: 'Either URL or file is required' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let result;
      if (url) {
        // Process URL
        result = await processDocument(url, 'url', null, env);
      } else if (file) {
        // Process file
        
        // Check file type
        const fileType = file.type || '';
        const fileName = file.name || '';
        const lowerFileName = fileName.toLowerCase();
        
        const isPDF = fileType.includes('pdf') || lowerFileName.endsWith('.pdf');
        const isText = fileType.includes('text') || lowerFileName.endsWith('.txt');
        const isImage = fileType.startsWith('image/') || 
                       lowerFileName.endsWith('.jpg') || 
                       lowerFileName.endsWith('.jpeg') || 
                       lowerFileName.endsWith('.png') || 
                       lowerFileName.endsWith('.gif') || 
                       lowerFileName.endsWith('.webp') || 
                       lowerFileName.endsWith('.bmp');
        
        if (!isPDF && !isText && !isImage) {
          return new Response(JSON.stringify({ 
            error: 'Unsupported file type',
            message: `File type "${fileType || 'unknown'}" is not supported. Please upload a PDF, text file, or image.`,
            suggestion: 'Supported formats: PDF (.pdf), Text (.txt), or Images (.jpg, .jpeg, .png, .gif, .webp, .bmp)'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const arrayBuffer = await file.arrayBuffer();
        
        if (arrayBuffer.byteLength === 0) {
          return new Response(JSON.stringify({ 
            error: 'Empty file',
            message: 'The uploaded file is empty.',
            suggestion: 'Please upload a file with content.'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Check file size (limit to 10MB for documents, 5MB for images)
        const maxSize = isImage ? 5 * 1024 * 1024 : 10 * 1024 * 1024; // 5MB for images, 10MB for documents
        if (arrayBuffer.byteLength > maxSize) {
          return new Response(JSON.stringify({ 
            error: 'File too large',
            message: `File size (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB) exceeds the maximum allowed size of ${maxSize / (1024 * 1024)}MB.`,
            suggestion: 'Please upload a smaller file or compress the image/document.'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // For text files, extract directly
        if (isText) {
          try {
            // Try UTF-8 first, fallback to other encodings if needed
            let text;
            try {
              text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
            } catch (e) {
              // Fallback to latin1 if UTF-8 fails
              text = new TextDecoder('latin1', { fatal: false }).decode(arrayBuffer);
            }
            
            if (!text || text.trim().length === 0) {
              return new Response(JSON.stringify({ 
                error: 'Empty text file',
                message: 'The text file appears to be empty or contains no readable content.',
                suggestion: 'Please check the file and ensure it contains text content.'
              }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            result = await processDocument(text, 'text', null, env);
          } catch (textError) {
            console.error('Error processing text file:', textError);
            throw new Error(`Failed to process text file: ${textError.message}`);
          }
        } else if (isImage) {
          // For image files, use image processing
          try {
            result = await processDocument(fileName, 'image', arrayBuffer, env);
          } catch (imageError) {
            console.error('❌ Image processing error:', imageError);
            const errorMsg = imageError.message || 'Unknown error';
            
            // Provide more specific error message for image processing failures
            if (errorMsg.includes('vision models') || errorMsg.includes('not available')) {
              throw new Error(`Image processing failed: Vision models are not available in your Cloudflare Workers AI plan.\n\nVision models require a paid plan. Alternatives:\n1. Describe the image in text and ask questions about it\n2. Use OCR tools to extract text from images before uploading\n3. Upgrade your Cloudflare Workers AI plan`);
            } else {
              throw new Error(`Failed to process image: ${errorMsg}`);
            }
          }
        } else {
          // For PDF files, use PDF extraction
          result = await processDocument(file.name, 'pdf', arrayBuffer, env);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        documentId: result.documentId,
        chunks: result.chunks,
        message: 'Document processed and stored successfully'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Document upload error:', error);
      console.error('Error stack:', error.stack);
      
      // Provide more specific error messages
      let errorMessage = error.message || 'Unknown error';
      let errorDetails = '';
      let suggestion = '';
      
      // Check for image/vision model errors first (before PDF errors)
      if (errorMessage.includes('image') || errorMessage.includes('vision') || errorMessage.includes('Image understanding')) {
        // Extract the actual error message from the error
        if (errorMessage.includes('Authentication error')) {
          errorDetails = `Image processing failed: Authentication error. Please ensure you are logged in with 'wrangler login'.`;
          suggestion = 'Run: wrangler login\n\nThen restart the dev server and try uploading the image again.';
        } else if (errorMessage.includes('not available') || errorMessage.includes('paid plan')) {
          errorDetails = `Image processing failed: Vision models are not available in your Cloudflare Workers AI plan.`;
          suggestion = 'Vision models require a paid Cloudflare Workers AI plan.\n\nAlternatives:\n1. Describe the image in text and ask questions about it\n2. Use OCR tools (like Google Lens, Adobe Acrobat) to extract text from images before uploading\n3. Convert images to text files manually\n4. Upgrade your Cloudflare Workers AI plan to access vision models\n5. Use text files, PDFs, or URLs instead';
        } else {
          errorDetails = `Image processing failed: ${errorMessage.split('\n')[0]}`;
          suggestion = 'Please check:\n1. You are logged in: wrangler login\n2. Your Cloudflare Workers AI plan supports vision models\n3. The image file is valid and not corrupted\n4. The image size is within limits (max 5MB)';
        }
      } else if (errorMessage.includes('Vectorize') || errorMessage.includes('binding not available')) {
        errorDetails = `Vectorize binding issue: ${errorMessage}. The Vectorize index exists, but the binding may not be available in the current dev mode.`;
        suggestion = 'Try these steps:\n1. Stop the dev server (Ctrl+C)\n2. Restart with: npm run dev (make sure --local flag is NOT used)\n3. Ensure you are logged in: wrangler login\n4. Verify the index exists: wrangler vectorize list';
      } else if (errorMessage.includes('PDF') || errorMessage.includes('extract') || errorMessage.includes('Could not extract')) {
        errorDetails = `PDF extraction failed: ${errorMessage}. The PDF may be image-based, encrypted, or the text extraction method may not support this PDF format.`;
        suggestion = 'Try one of these options:\n1. Convert the PDF to a text file (.txt) and upload that instead\n2. Copy the PDF content to a text file\n3. Use a URL to an article or webpage instead\n4. Ensure the PDF contains selectable text (not just images)';
      } else if (errorMessage.includes('embedding') || errorMessage.includes('AI') || errorMessage.includes('binding not available')) {
        errorDetails = `Failed to create embeddings: ${errorMessage}. Please check your Cloudflare Workers AI configuration.`;
        suggestion = 'Ensure you are logged in with: wrangler login';
      } else if (errorMessage.includes('No text extracted') || errorMessage.includes('empty')) {
        errorDetails = errorMessage;
        suggestion = 'The document appears to be empty or contains no extractable text. Please check the file and try again.';
      } else {
        errorDetails = errorMessage;
        if (error.stack) {
          errorDetails += `\n\nStack trace: ${error.stack}`;
        }
        suggestion = 'Please check the file format and try again. For PDFs, try converting to text format first.';
      }
      
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Failed to process document',
        message: errorMessage,
        details: errorDetails,
        suggestion: suggestion
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  async handleHealthCheck(corsHeaders) {
    return new Response(JSON.stringify({
      status: 'healthy',
      timestamp: Date.now(),
      service: 'AI Agent with Function Calling & RAG',
      version: '2.1.0',
      mode: 'agent',
      capabilities: ['function_calling', 'tool_use', 'autonomous_decision_making', 'rag', 'vectorize']
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
