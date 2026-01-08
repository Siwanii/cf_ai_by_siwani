
// This is the RAG (Retrieval-Augmented Generation) module - it handles all the
// document stuff. When you upload a PDF or image, this processes it, chunks it up,
// creates embeddings, and stores everything in Vectorize so the AI can find it later


const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';
const CHUNK_SIZE = 500; // Characters per chunk
const CHUNK_OVERLAP = 50; // Overlap between chunks
const TOP_K = 3; // Number of similar chunks to retrieve

// Split text into chunks - I use 500 characters with 50 char overlap because
// that seems to work well. I also try to break at sentence boundaries so chunks
// make more sense. Filtering out PDF metadata was a pain but necessary
export function chunkText(text) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    let chunk = text.substring(start, end);
    
    // Try to break at sentence boundaries
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf('.');
      const lastNewline = chunk.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);
      
      if (breakPoint > CHUNK_SIZE * 0.5) {
        chunk = chunk.substring(0, breakPoint + 1);
        start += breakPoint + 1 - CHUNK_OVERLAP;
      } else {
        start += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    } else {
      start = text.length;
    }
    
    // Clean and add chunk - filter out metadata/structure chunks
    chunk = chunk.trim();
    
    // Filter out chunks that are mostly PDF metadata/structure
    if (chunk.length > 0) {
      const lowerChunk = chunk.toLowerCase();
      const metadataKeywords = [
        'xmp', 'metadata', 'producer', 'creator', 'trapped', 'uuid', 'documentid',
        'instanceid', 'adobe', 'pdf library', 'xobject', 'xref', 'trailer', 'rdf:',
        'xmlns:', 'xmpmm:', 'dc:', 'xap:', 'xmp:createdate', 'xmp:metadatadate',
        'xmp:modifydate', 'xmp:creatortool', 'adobe indesign', 'bitspercomponent',
        'colorspace', 'devicergb', 'flatedecode', 'smask', 'subtype', 'image object',
        'xmp core', 'adobe xmp core', 'metadata framework', 'xml extensible',
        'the document starts with', 'the document includes', 'the document also includes',
        'the document contains', 'embedded in the pdf', 'pdf file with'
      ];
      const metadataCount = metadataKeywords.filter(kw => lowerChunk.includes(kw)).length;
      const wordCount = chunk.split(/\s+/).length;
      
      // Skip chunks that are mostly metadata (more than 10% metadata keywords - more aggressive)
      const isMetadataHeavy = metadataCount > wordCount * 0.10 || metadataCount > 3;
      
      // Check for repeated characters (noise like UUUUUU...)
      const hasRepeatedChars = /(.)\1{10,}/.test(chunk);
      
      // Check for number sequences (PDF object references)
      const isNumberSequence = /^[0-9\s]+$/.test(chunk) || /\d+\s+0\s+R(\s+\d+\s+0\s+R){3,}/.test(chunk);
      
      // Skip chunks that are mostly numbers, very short, or contain noise
      const isInvalid = isNumberSequence || chunk.length < 20 || hasRepeatedChars;
      
      // Only add chunk if it's valid content
      if (!isMetadataHeavy && !isInvalid) {
        chunks.push(chunk);
      }
    }
  }
  
  return chunks;
}

// Extracts text from PDFs - this was tricky because PDFs are messy
// I extract from BT/ET blocks and filter out all the metadata junk
// It's not perfect but it works for most PDFs. For production you'd want
// a proper PDF library, but this gets the job done
export async function extractTextFromPDF(pdfData) {
  // Filtering out PDF metadata was a nightmare - there's so much junk in there
  // I learned to look for specific patterns and skip anything that looks like
  // structure/metadata rather than actual content
  
  try {
    const uint8Array = new Uint8Array(pdfData);
    
    // Convert to string to search for text streams
    const pdfString = Array.from(uint8Array)
      .map(b => String.fromCharCode(b))
      .join('');
    
    // Keywords that indicate metadata/structure (to filter out)
    const metadataKeywords = [
      'xmp', 'metadata', 'producer', 'creator', 'trapped', 'uuid', 'documentid',
      'instanceid', 'adobe', 'pdf library', 'xobject', 'xref', 'trailer', 'obj',
      'endobj', 'stream', 'endstream', 'xref', 'trailer', 'startxref', 'pdf-',
      'rdf:rdf', 'rdf:description', 'xmpmm:', 'dc:', 'xmp:', 'pdf:', 'xap:',
      'xmlns:', 'x:xmpmeta', 'rdf:about', 'xmpmetadata', 'xmpmeta', 'xmp:createdate',
      'xmp:metadatadate', 'xmp:modifydate', 'xmp:creatortool', 'adobe indesign',
      'bitspercomponent', 'colorspace', 'devicergb', 'flatedecode', 'smask',
      'subtype', 'image object', 'xobject', 'embedded object', 'image objects',
      'xmp core', 'adobe xmp core', 'metadata framework', 'xml extensible'
    ];
    
    // Function to check if text is likely metadata/structure
    const isMetadata = (text) => {
      const lowerText = text.toLowerCase();
      return metadataKeywords.some(keyword => lowerText.includes(keyword)) ||
             /^[a-z]+:[a-z]+/i.test(text) || // XML namespaces
             /uuid:[a-f0-9-]+/i.test(text) || // UUIDs
             /^[0-9]+\s+0\s+obj/i.test(text); // PDF object markers
    };
    
    let text = '';
    
    // Strategy 1: Extract text from BT/ET blocks (Begin Text / End Text) - most reliable
    const textBlockRegex = /BT[\s\S]*?ET/gi;
    const textBlocks = pdfString.match(textBlockRegex) || [];
    for (const block of textBlocks) {
      // Extract text between parentheses (actual content)
      const textMatches = block.match(/\(([^)]+)\)/g);
      if (textMatches) {
        for (const match of textMatches) {
          // Remove parentheses and decode PDF text encoding
          let extracted = match.replace(/^\(|\)$/g, '');
          
          // Decode PDF escape sequences
          extracted = extracted
            .replace(/\\n/g, ' ')
            .replace(/\\r/g, ' ')
            .replace(/\\t/g, ' ')
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/\\\\/g, '\\');
          
          // Filter out metadata, noise, and ensure it's readable content
          // Check for repeated characters (like UUUUUU...)
          const hasRepeatedChars = /(.)\1{10,}/.test(extracted);
          // Check for mostly numbers and spaces (PDF object references)
          const isNumberSequence = /^[0-9\s]+$/.test(extracted) || /^\d+\s+0\s+R/.test(extracted);
          // Check for very short or meaningless text
          const isTooShort = extracted.length < 5;
          // Check for meaningful words (at least 3 consecutive letters)
          const hasMeaningfulWords = /[a-zA-Z]{3,}/.test(extracted);
          
          if (!isMetadata(extracted) && 
              !hasRepeatedChars &&
              !isNumberSequence &&
              !isTooShort &&
              hasMeaningfulWords) {
            text += extracted + ' ';
          }
        }
      }
    }
    
    // Strategy 2: Extract from text objects (Tj, TJ operators)
    if (text.trim().length < 100) {
      // Look for text between parentheses followed by Tj or TJ
      const textObjectRegex = /\(([^)]{5,})\)\s*T[jJ]/g;
      let match;
      while ((match = textObjectRegex.exec(pdfString)) !== null) {
        const extracted = match[1];
        // Check for repeated characters and number sequences
        const hasRepeatedChars = /(.)\1{10,}/.test(extracted);
        const isNumberSequence = /^[0-9\s]+$/.test(extracted) || /^\d+\s+0\s+R/.test(extracted);
        const hasMeaningfulWords = /[a-zA-Z]{3,}/.test(extracted);
        
        if (!isMetadata(extracted) && 
            !hasRepeatedChars &&
            !isNumberSequence &&
            extracted.length > 5 &&
            hasMeaningfulWords) {
          text += extracted + ' ';
        }
      }
    }
    
    // Strategy 3: Extract from streams (fallback)
    if (text.trim().length < 100) {
      const streamRegex = /stream[\s\S]*?endstream/gi;
      const streams = pdfString.match(streamRegex) || [];
      
      for (const stream of streams) {
        const content = stream.replace(/^stream[\s\n\r]*/i, '').replace(/[\s\n\r]*endstream$/i, '');
        
        // Look for readable text patterns
        const textMatches = content.match(/[a-zA-Z0-9\s.,!?;:()\-'"]{20,}/g);
        if (textMatches) {
          for (const match of textMatches) {
            // Check for repeated characters (noise)
            const hasRepeatedChars = /(.)\1{10,}/.test(match);
            // Check for number sequences (PDF object references)
            const isNumberSequence = /^[0-9\s]+$/.test(match) || /\d+\s+0\s+R/g.test(match);
            // Check for meaningful content
            const hasMeaningfulWords = /[a-zA-Z]{5,}/.test(match);
            
            if (!isMetadata(match) && 
                !hasRepeatedChars &&
                !isNumberSequence &&
                hasMeaningfulWords) {
              text += match + ' ';
            }
          }
        }
      }
    }
    
    // Clean up the extracted text
    text = text
      .replace(/\s+/g, ' ') // Multiple spaces to single
      .replace(/[^\w\s.,!?;:()\-'"]/g, ' ') // Remove special chars but keep punctuation
      .replace(/\s+/g, ' ') // Clean up again
      .trim();
    
    // Filter out chunks that are mostly metadata/structure, noise, or number sequences
    const lines = text.split(/\s+/);
    const filteredLines = lines.filter(line => {
      // Check for repeated characters (like UUUUUU...)
      const hasRepeatedChars = /(.)\1{10,}/.test(line);
      // Check for number sequences (PDF object references like "94 0 R")
      const isNumberSequence = /^[0-9\s]+$/.test(line) || /^\d+\s+0\s+R/.test(line);
      // Check for meaningful content
      const hasMeaningfulContent = line.length > 3 && /[a-zA-Z]/.test(line);
      
      return !isMetadata(line) && 
             !hasRepeatedChars &&
             !isNumberSequence &&
             hasMeaningfulContent;
    });
    
    text = filteredLines.join(' ');
    
    // Additional cleanup: Remove any remaining repeated character sequences
    text = text.replace(/(.)\1{20,}/g, ''); // Remove sequences of 20+ repeated characters
    text = text.replace(/\d+\s+0\s+R(\s+\d+\s+0\s+R){5,}/g, ''); // Remove long sequences of PDF object references
    
    // Final validation - ensure we have actual content, not just metadata
    const finalText = text.trim();
    if (finalText.length < 50) {
      throw new Error('Could not extract sufficient text from PDF. The PDF might be image-based, encrypted, or the text extraction method may not support this PDF format.');
    }
    
    // Check if extracted text is mostly metadata
    const metadataCount = metadataKeywords.filter(kw => finalText.toLowerCase().includes(kw)).length;
    const wordCount = finalText.split(/\s+/).length;
    if (metadataCount > wordCount / 10) {
      // Try to extract only sentences/paragraphs that don't contain metadata keywords
      const sentences = finalText.split(/[.!?]\s+/);
      const cleanSentences = sentences.filter(s => {
        const lowerS = s.toLowerCase();
        return !metadataKeywords.some(kw => lowerS.includes(kw)) &&
               s.length > 20 &&
               /[a-zA-Z]{5,}/.test(s);
      });
      
      if (cleanSentences.length > 0) {
        const cleanedResult = cleanSentences.join('. ') + '.';
        return cleanedResult;
      }
    }
    
    return finalText;
  } catch (error) {
    throw new Error(`PDF extraction failed: ${error.message}`);
  }
}

// Fetches text from a URL - handles HTML by stripping tags, or just returns
// plain text if that's what it is. Pretty straightforward
export async function extractTextFromURL(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('text/html')) {
      const html = await response.text();
      // Simple HTML text extraction (remove scripts, styles, etc.)
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text;
    } else if (contentType.includes('text/plain')) {
      return await response.text();
    } else {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
  } catch (error) {
    throw new Error(`Error fetching URL: ${error.message}`);
  }
}

// Creates embeddings using the BGE model - this converts text into vectors
// that can be searched. The model returns different formats sometimes, so I
// had to handle a bunch of edge cases. Fun times!
export async function createEmbeddings(chunks, env) {
  if (!env.AI) {
    throw new Error('AI binding not available');
  }
  
  const embeddings = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      if (!chunk || chunk.trim().length === 0) {
        console.warn(`Empty chunk at index ${i}, skipping`);
        continue;
      }
      
      const embedding = await env.AI.run(EMBEDDING_MODEL, {
        text: chunk
      });
      
      // Handle different response formats from BGE model
      // BGE model can return: { shape: [1, 384], data: Float32Array } or similar
      let vector = null;
      
      if (embedding) {
        // Log the structure for debugging
        console.log('Embedding structure:', {
          type: typeof embedding,
          isArray: Array.isArray(embedding),
          keys: typeof embedding === 'object' ? Object.keys(embedding) : null,
          hasData: !!(embedding.data),
          hasShape: !!(embedding.shape),
          shape: embedding.shape
        });
        
        // Check for shape-based format first (most common for BGE)
        if (embedding.shape && embedding.data) {
          // Handle { shape: [1, 384], data: Float32Array }
          const shape = embedding.shape;
          const data = embedding.data;
          
          // If shape is [1, 384], we need to flatten or extract the first row
          if (Array.isArray(shape) && shape.length === 2 && shape[0] === 1) {
            // Extract the 384-dimensional vector
            if (data instanceof Float32Array) {
              vector = Array.from(data);
            } else if (Array.isArray(data)) {
              // If data is nested array, flatten it
              if (Array.isArray(data[0])) {
                vector = data[0]; // Take first row
              } else {
                vector = data; // Already flat
              }
            } else if (data.buffer) {
              vector = Array.from(new Float32Array(data.buffer));
            }
          } else {
            // Try to extract directly
            if (data instanceof Float32Array || data instanceof Array) {
              vector = Array.from(data);
            }
          }
        } else if (embedding.data) {
          // Handle { data: [...] } format
          if (embedding.data instanceof Float32Array) {
            vector = Array.from(embedding.data);
          } else if (Array.isArray(embedding.data)) {
            // Check if nested array
            if (Array.isArray(embedding.data[0])) {
              vector = embedding.data[0]; // Take first row if nested
            } else {
              vector = embedding.data; // Already flat
            }
          } else if (embedding.data.buffer) {
            vector = Array.from(new Float32Array(embedding.data.buffer));
          }
        } else if (Array.isArray(embedding)) {
          // Direct array format
          if (Array.isArray(embedding[0])) {
            vector = embedding[0]; // Take first row if nested
          } else {
            vector = embedding; // Already flat
          }
        } else if (embedding.embedding && Array.isArray(embedding.embedding)) {
          vector = embedding.embedding;
        } else if (typeof embedding === 'object' && 'values' in embedding) {
          vector = embedding.values;
        }
      }
      
      // If still no vector, log the full structure for debugging
      if (!vector) {
        console.error('❌ Could not extract vector from embedding response:', {
          type: typeof embedding,
          embedding: JSON.stringify(embedding, null, 2).substring(0, 500),
          keys: embedding ? Object.keys(embedding) : null
        });
        throw new Error(`Failed to extract embedding vector from response for chunk ${i}`);
      }
      
      if (Array.isArray(vector) && vector.length > 0) {
        // Validate dimensions (should be 384 for bge-small-en-v1.5)
        if (vector.length !== 384) {
          console.error(`❌ Invalid embedding dimension: ${vector.length}, expected 384`);
          console.error(`Vector sample (first 10 values):`, vector.slice(0, 10));
          throw new Error(`Embedding has ${vector.length} dimensions, expected 384. The embedding extraction may be incorrect.`);
        }
        
        // Ensure all values are numbers
        const numericVector = vector.map((v, idx) => {
          const num = typeof v === 'number' ? v : parseFloat(v);
          if (isNaN(num)) {
            throw new Error(`Invalid embedding value at chunk ${i}, position ${idx}: ${v} (type: ${typeof v})`);
          }
          return num;
        });
        
        embeddings.push(numericVector);
      } else {
        console.error('❌ Invalid embedding format:', {
          chunk: chunk.substring(0, 50),
          vectorType: typeof vector,
          vectorLength: vector ? vector.length : null,
          vectorIsArray: Array.isArray(vector),
          embeddingType: typeof embedding,
          embeddingKeys: embedding ? Object.keys(embedding) : null
        });
        throw new Error(`Failed to create embedding for chunk ${i}: Invalid response format - vector is not a valid array`);
      }
    } catch (error) {
      console.error(`Error creating embedding for chunk ${i}:`, error);
      throw new Error(`Failed to create embedding: ${error.message}`);
    }
  }
  
  if (embeddings.length === 0) {
    throw new Error('No embeddings were created');
  }
  
  return embeddings;
}

// Stores everything in Vectorize - the chunks, embeddings, and metadata
// I include timestamps so we can prioritize recent documents. Also had to
// validate everything because Vectorize is picky about data types
export async function storeInVectorize(chunks, embeddings, documentId, env) {
  // Check for Vectorize binding (try different possible names)
  const vectorize = env.VECTORIZE || env.vectorize || env.Vectorize;
  if (!vectorize) {
    const envKeys = Object.keys(env || {});
    const vectorKeys = envKeys.filter(k => k.toLowerCase().includes('vector'));
    console.error('❌ Vectorize binding check failed:', {
      hasVECTORIZE: !!env.VECTORIZE,
      hasvectorize: !!env.vectorize,
      hasVectorize: !!env.Vectorize,
      allEnvKeys: envKeys,
      vectorRelatedKeys: vectorKeys
    });
    throw new Error('Vectorize binding not available. Please ensure the Vectorize binding is configured in wrangler.toml and restart the dev server with: npm run dev (without --local flag).');
  }
  
  
  // Validate embeddings
  if (!embeddings || embeddings.length === 0) {
    throw new Error('No embeddings generated');
  }
  
  if (embeddings.length !== chunks.length) {
    throw new Error(`Embedding count (${embeddings.length}) doesn't match chunk count (${chunks.length})`);
  }
  
  const vectors = chunks.map((chunk, index) => {
    const embedding = embeddings[index];
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Invalid embedding at index ${index}`);
    }
    
    // Validate embedding dimensions
    if (embedding.length !== 384) {
      console.warn(`Warning: Embedding at index ${index} has dimension ${embedding.length}, expected 384`);
    }
    
    // Ensure all values are numbers (not strings or other types)
    const validValues = embedding.map((v, i) => {
      const num = typeof v === 'number' ? v : parseFloat(v);
      if (isNaN(num)) {
        throw new Error(`Invalid embedding value at index ${index}, position ${i}: ${v} is not a number`);
      }
      return num;
    });
    
    // Store the FULL chunk text in metadata for retrieval
    // Vectorize metadata can handle up to 2000 chars, so store the full chunk
    const cleanText = chunk.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim(); // Remove control characters
    // Limit to 2000 chars to stay within Vectorize metadata limits
    const metadataText = cleanText.substring(0, 2000);
    
    return {
      id: `${documentId}-chunk-${index}`,
      values: validValues,
      metadata: {
        documentId: String(documentId),
        chunkIndex: Number(index),
        text: cleanText,
        timestamp: Date.now() // Add timestamp for sorting by recency
      }
    };
  });
  
  // Validate vectors before upsert
  if (vectors.length > 0) {
    console.log('First vector structure:', {
      id: vectors[0].id,
      valuesLength: vectors[0].values.length,
      firstValue: vectors[0].values[0],
      lastValue: vectors[0].values[vectors[0].values.length - 1],
      metadataKeys: Object.keys(vectors[0].metadata),
      metadataTextLength: vectors[0].metadata.text.length
    });
  }
  
  try {
    // Upsert vectors into Vectorize (insert or update)
    const vectorize = env.VECTORIZE || env.vectorize || env.Vectorize;
    const result = await vectorize.upsert(vectors);
    return result;
  } catch (error) {
    console.error('❌ Error storing in Vectorize:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      vectorsCount: vectors.length,
      errorCode: error.code,
      errorName: error.name
    });
    
    // Log first vector structure for debugging
    if (vectors.length > 0) {
      console.error('First vector structure:', JSON.stringify({
        id: vectors[0].id,
        valuesLength: vectors[0].values.length,
        valuesType: typeof vectors[0].values[0],
        sampleValues: vectors[0].values.slice(0, 5),
        metadata: vectors[0].metadata
      }, null, 2));
    }
    
    throw new Error(`Failed to store in Vectorize: ${error.message}. Make sure the index exists and has the correct dimensions (384).`);
  }
}

// Queries Vectorize by document ID - I added this because of a race condition
// where images would be uploaded but not indexed yet. This bypasses similarity
// search and just grabs chunks by ID, with retries because indexing takes time
export async function queryByDocumentId(documentId, env, maxRetries = 5, initialDelay = 2000) {
  const vectorize = env.VECTORIZE || env.vectorize || env.Vectorize;
  if (!vectorize) {
    console.warn('Vectorize not available, cannot query by document ID');
    return [];
  }

  // Use a generic query that should match any document, then filter by documentId
  // We'll use a very generic embedding query
  const genericQuery = '[IMAGE DESCRIPTION]'; // Generic query that should match image descriptions
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Create embedding for generic query
      const queryEmbedding = await env.AI.run(EMBEDDING_MODEL, {
        text: genericQuery
      });
      
      // Extract vector (same logic as similaritySearch)
      let queryVector = null;
      if (queryEmbedding) {
        if (queryEmbedding.shape && queryEmbedding.data) {
          const shape = queryEmbedding.shape;
          const data = queryEmbedding.data;
          if (Array.isArray(shape) && shape.length === 2 && shape[0] === 1) {
            if (data instanceof Float32Array) {
              queryVector = Array.from(data);
            } else if (Array.isArray(data)) {
              queryVector = Array.isArray(data[0]) ? data[0] : data;
            }
          }
        } else if (Array.isArray(queryEmbedding)) {
          queryVector = Array.isArray(queryEmbedding[0]) ? queryEmbedding[0] : queryEmbedding;
        }
      }
      
      if (!queryVector || queryVector.length !== 384) {
        throw new Error('Invalid query vector');
      }
      
      // Query with a large topK to get many results, then filter by documentId
      const results = await vectorize.query(queryVector, { topK: 200 }); // Increased to 200
      
      // Filter results to only include chunks from the specified documentId
      const documentChunks = (results.matches || []).filter(match => {
        const matchDocId = match.metadata?.documentId || match.id?.split('-chunk-')[0];
        // Try both exact match and string comparison (in case of type mismatch)
        const matches = matchDocId === documentId || String(matchDocId) === String(documentId);
        if (!matches && attempt === 0) {
          // Log on first attempt for debugging
        }
        return matches;
      }).map(match => ({
        id: match.id,
        text: match.metadata?.text || '',
        score: match.score || 0,
        metadata: match.metadata || {}
      }));
      
      if (documentChunks.length > 0) {
        return documentChunks;
      } else {
        // Log what we found for debugging
        if (attempt === 0 && results.matches && results.matches.length > 0) {
          const sampleDocIds = [...new Set(results.matches.slice(0, 10).map(m => 
            m.metadata?.documentId || m.id?.split('-chunk-')[0] || 'unknown'
          ))];
        }
      }
      
      // If no results and not the last attempt, wait and retry
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.warn(`⚠️ Error querying document ${documentId} (attempt ${attempt + 1}/${maxRetries}):`, error.message);
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.warn(`⚠️ Document ${documentId} not found after ${maxRetries} attempts (may still be indexing)`);
  return [];
}

// Does the actual similarity search - converts the query to an embedding,
// searches Vectorize, and filters out junk. I filter pretty aggressively
// because PDF metadata was showing up in results and that was annoying
export async function similaritySearch(query, env, topK = TOP_K) {
  // Check for Vectorize binding (try different possible names)
  const vectorize = env.VECTORIZE || env.vectorize || env.Vectorize;
  if (!vectorize) {
    console.warn('Vectorize not available, skipping RAG');
    return [];
  }
  
  try {
    // Create embedding for the query (same format as chunk embeddings)
    const queryEmbedding = await env.AI.run(EMBEDDING_MODEL, {
      text: query
    });
    
    // Extract vector using same logic as chunk embeddings
    let queryVector = null;
    if (queryEmbedding) {
      // Handle shape-based format first (most common for BGE)
      if (queryEmbedding.shape && queryEmbedding.data) {
        const shape = queryEmbedding.shape;
        const data = queryEmbedding.data;
        if (Array.isArray(shape) && shape.length === 2 && shape[0] === 1) {
          if (data instanceof Float32Array) {
            queryVector = Array.from(data);
          } else if (Array.isArray(data)) {
            queryVector = Array.isArray(data[0]) ? data[0] : data;
          } else if (data.buffer) {
            queryVector = Array.from(new Float32Array(data.buffer));
          }
        } else if (data instanceof Float32Array || Array.isArray(data)) {
          queryVector = Array.from(data);
        }
      } else if (queryEmbedding.data) {
        if (queryEmbedding.data instanceof Float32Array) {
          queryVector = Array.from(queryEmbedding.data);
        } else if (Array.isArray(queryEmbedding.data)) {
          queryVector = Array.isArray(queryEmbedding.data[0]) ? queryEmbedding.data[0] : queryEmbedding.data;
        }
      } else if (Array.isArray(queryEmbedding)) {
        queryVector = Array.isArray(queryEmbedding[0]) ? queryEmbedding[0] : queryEmbedding;
      }
    }
    
    if (!Array.isArray(queryVector) || queryVector.length === 0 || queryVector.length !== 384) {
      console.error('❌ Invalid query embedding:', {
        isArray: Array.isArray(queryVector),
        length: queryVector ? queryVector.length : 0,
        expected: 384
      });
      return [];
    }
    
    console.log(`🔍 Query embedding created: ${queryVector.length} dimensions`);
    
    // Perform similarity search
    const results = await vectorize.query(queryVector, {
      topK: topK,
      returnMetadata: true
    });
    
    // Format results - handle different response formats
    let matches = [];
    if (results && results.matches) {
      matches = results.matches;
    } else if (Array.isArray(results)) {
      matches = results;
    }
    
    // Filter out metadata/structure chunks (more aggressive filtering)
    const metadataKeywords = [
      'xmp', 'metadata', 'producer', 'creator', 'trapped', 'uuid', 'documentid',
      'instanceid', 'adobe', 'pdf library', 'xobject', 'xref', 'trailer', 'rdf:',
      'xmlns:', 'xmpmm:', 'dc:', 'xap:', 'x:xmpmeta', 'xmp:createdate', 'xmp:metadatadate',
      'xmp:modifydate', 'xmp:creatortool', 'adobe indesign', 'bitspercomponent',
      'colorspace', 'devicergb', 'flatedecode', 'smask', 'subtype', 'image object',
      'xmp core', 'adobe xmp core', 'metadata framework', 'xml extensible',
      'the document starts with', 'the document includes', 'the document also includes',
      'the document contains', 'embedded in the pdf', 'pdf file with', 'document content appears',
      'breakdown of the content', 'here\'s a breakdown', 'the document', 'pdf file'
    ];
    
    const formattedMatches = matches.map(match => {
      // Extract text from metadata - try different possible fields
      const text = match.metadata?.text || 
                   match.text || 
                   match.metadata?.content ||
                   '';
      
      return {
        text: text,
        score: match.score || 0,
        metadata: match.metadata || {},
        id: match.id || match.metadata?.id || ''
      };
    }).filter(match => {
      // Filter out empty text
      if (!match.text || match.text.trim().length === 0) {
        return false;
      }
      
      // Filter out chunks that are mostly metadata (more aggressive)
      const lowerText = match.text.toLowerCase();
      const metadataCount = metadataKeywords.filter(kw => lowerText.includes(kw)).length;
      const wordCount = match.text.split(/\s+/).length;
      
      // Skip if more than 10% of words are metadata keywords OR if it has more than 3 metadata keywords
      if (metadataCount > wordCount * 0.10 || metadataCount > 3) {
        return false;
      }
      
      // Skip if it starts with common metadata phrases (but allow image descriptions)
      const isImageDescription = lowerText.includes('[image description]') || 
                                 lowerText.includes('image shows') ||
                                 lowerText.includes('in the image') ||
                                 lowerText.includes('the image contains') ||
                                 lowerText.includes('picture shows') ||
                                 lowerText.includes('photo shows');
      
      if (!isImageDescription && (
          lowerText.startsWith('the document') || 
          lowerText.startsWith('document content') ||
          lowerText.includes('pdf file with') ||
          lowerText.includes('breakdown of the content'))) {
        return false;
      }
      
      // Check for repeated characters (noise)
      const hasRepeatedChars = /(.)\1{10,}/.test(match.text);
      
      // Check for number sequences (PDF object references)
      const isNumberSequence = /^[0-9\s]+$/.test(match.text) || /\d+\s+0\s+R(\s+\d+\s+0\s+R){3,}/.test(match.text);
      
      // Skip if it's mostly numbers, very short, or contains noise
      if (isNumberSequence || match.text.trim().length < 20 || hasRepeatedChars) {
        return false;
      }
      
      return true;
    });
    
    // Sort by score (highest first), but prioritize more recent documents
    // For documents with similar scores, prefer newer ones
    formattedMatches.sort((a, b) => {
      const scoreA = b.score || 0;
      const scoreB = a.score || 0;
      const timestampA = a.metadata?.timestamp || 0;
      const timestampB = b.metadata?.timestamp || 0;
      
      // If scores are very close (within 0.1), prefer newer document
      if (Math.abs(scoreA - scoreB) < 0.1) {
        return timestampB - timestampA; // Newer first
      }
      
      // Otherwise, sort by score
      return scoreA - scoreB;
    });
    
    console.log(`🔍 Similarity search found ${formattedMatches.length} matches with text content`);
    if (formattedMatches.length > 0) {
      console.log(`📄 Top match: score=${formattedMatches[0].score?.toFixed(3)}, timestamp=${formattedMatches[0].metadata?.timestamp || 'unknown'}, text preview: ${formattedMatches[0].text.substring(0, 150)}`);
      console.log(`📄 Document IDs found: ${[...new Set(formattedMatches.map(m => m.metadata?.documentId || 'unknown'))].join(', ')}`);
    }
    
    return formattedMatches;
    
  } catch (error) {
    console.error('Error in similarity search:', error);
    return [];
  }
}

// Extracts text/description from images using vision models - I try multiple
// models because they're not all available on every plan. The base64 conversion
// was a pain but necessary. Also handles different response formats because
// nothing is ever consistent
async function extractTextFromImage(imageData, env) {
  try {
    const uint8Array = new Uint8Array(imageData);
    
    // Convert to base64 for Workers AI (most vision models expect base64)
    let base64Image = '';
    try {
      // Convert Uint8Array to base64
      const binaryString = String.fromCharCode.apply(null, uint8Array);
      base64Image = btoa(binaryString);
    } catch (base64Error) {
      console.warn('Base64 conversion failed, trying alternative method:', base64Error);
      // Alternative: use Buffer if available, or try direct array
      base64Image = null;
    }
    
    // Use Cloudflare Workers AI image understanding models
    // Try multiple vision models in order of preference
    const visionModels = [
      {
        name: '@cf/llava-hf/llava-1.5-7b',
        prompt: "Describe this image in detail, including any text visible in the image. Be thorough and descriptive. If there is text in the image, transcribe it exactly."
      },
      {
        name: '@cf/unum/uform-gen2-qwen-500m',
        prompt: "Describe everything you see in this image, including any text, objects, people, scenes, and details. Transcribe any visible text."
      },
      {
        name: '@cf/meta/llama-3.2-11b-vision-instruct',
        prompt: "Analyze this image and describe what you see, including any text content. Be detailed and accurate."
      }
    ];
    
    // Track error details for better diagnostics
    const errorDetails = {
      firstError: null,
      hasAuthError: false,
      hasAvailabilityError: false,
      hasPlanError: false
    };
    
    for (const model of visionModels) {
      try {
        console.log(`🖼️ Trying vision model: ${model.name}`);
        console.log(`📊 Image size: ${uint8Array.length} bytes`);
        
        // Try different image formats that Workers AI might accept
        let response = null;
        const formatsToTry = [];
        
        // Format 1: Base64 string
        if (base64Image) {
          formatsToTry.push({ image: base64Image });
        }
        
        // Format 2: Uint8Array directly
        formatsToTry.push({ image: uint8Array });
        
        // Format 3: Array from Uint8Array
        formatsToTry.push({ image: Array.from(uint8Array) });
        
        // Format 4: With messages format (some models use this)
        if (base64Image) {
          formatsToTry.push({
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: model.prompt },
                  { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                ]
              }
            ]
          });
        }
        
        // Try each format until one works
        for (const format of formatsToTry) {
          try {
            console.log(`🔄 Trying format: ${Object.keys(format)[0]}`);
            
            if (format.messages) {
              // For message-based format
              response = await env.AI.run(model.name, format);
            } else {
              // For direct image format
              response = await env.AI.run(model.name, {
                ...format,
                prompt: model.prompt
              });
            }
            
            // If we got a response, break out of format loop
            if (response) {
              break;
            }
          } catch (formatError) {
            console.warn(`⚠️ Format failed:`, formatError.message);
            continue; // Try next format
          }
        }
        
        if (!response) {
          throw new Error('No response from model with any format');
        }
        
        console.log(`📥 Response received from ${model.name}:`, typeof response, response ? Object.keys(response) : 'null');
        
        // Handle different response formats
        let description = '';
        if (response && typeof response === 'string') {
          description = response;
        } else if (response && response.description) {
          description = response.description;
        } else if (response && response.response) {
          description = response.response;
        } else if (response && response.text) {
          description = response.text;
        } else if (response && response.choices && response.choices[0] && response.choices[0].message) {
          description = response.choices[0].message.content || response.choices[0].message.text || '';
        } else if (response && response.content) {
          description = response.content;
        } else if (response && Array.isArray(response) && response.length > 0) {
          description = response.map(r => typeof r === 'string' ? r : r.text || r.description || r.content || '').join(' ');
        } else if (response && typeof response === 'object') {
          // Try to extract any text-like fields
          const possibleFields = ['output', 'result', 'answer', 'summary', 'description', 'text', 'content'];
          for (const field of possibleFields) {
            if (response[field] && typeof response[field] === 'string') {
              description = response[field];
              break;
            }
          }
        }
        
        if (description && description.trim().length > 10) {
          console.log(`✅ Successfully extracted ${description.length} characters from image using ${model.name}`);
          return description.trim();
        } else {
          console.warn(`⚠️ Response from ${model.name} was empty or too short:`, description);
        }
      } catch (modelError) {
        console.warn(`⚠️ Model ${model.name} failed:`, modelError.message);
        console.warn(`📋 Error details:`, modelError);
        
        // Check for specific error types
        const errorMsg = modelError.message?.toLowerCase() || '';
        const errorString = String(modelError).toLowerCase();
        
        // Store the first meaningful error for better diagnostics
        if (!errorDetails.firstError && errorMsg) {
          errorDetails.firstError = modelError.message || String(modelError);
        }
        
        // Check if it's an authentication/authorization error
        if (errorMsg.includes('not logged in') || errorMsg.includes('authentication') || errorMsg.includes('unauthorized')) {
          errorDetails.hasAuthError = true;
        }
        
        // Check if it's a model availability error
        if (errorMsg.includes('not available') || errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
          errorDetails.hasAvailabilityError = true;
        }
        
        // Check if it's a plan/limit error
        if (errorMsg.includes('plan') || errorMsg.includes('limit') || errorMsg.includes('quota') || errorMsg.includes('subscription')) {
          errorDetails.hasPlanError = true;
        }
        
        continue; // Try next model
      }
    }
    
    // If all models failed, provide helpful error with specific guidance
    const errorMessages = [];
    
    // Provide specific error message based on what we detected
    if (errorDetails.hasAuthError) {
      errorMessages.push('Authentication error: Please ensure you are logged in with `wrangler login`');
    } else if (errorDetails.hasAvailabilityError || errorDetails.hasPlanError) {
      errorMessages.push('Vision models are not available in your Cloudflare Workers AI plan.');
      errorMessages.push('Vision models require a paid Cloudflare Workers AI plan.');
    } else {
      errorMessages.push('Failed to process image with available vision models.');
      if (errorDetails.firstError) {
        errorMessages.push(`Error: ${errorDetails.firstError}`);
      }
    }
    
    errorMessages.push('');
    errorMessages.push('Alternative options:');
    errorMessages.push('1. Describe the image in text and ask questions about it');
    errorMessages.push('2. Use OCR tools (like Google Lens, Adobe Acrobat) to extract text from images before uploading');
    errorMessages.push('3. Convert images to text files manually');
    errorMessages.push('4. Upgrade your Cloudflare Workers AI plan to access vision models');
    errorMessages.push('5. Use text files, PDFs, or URLs instead');
    
    throw new Error(errorMessages.join('\n'));
    
  } catch (error) {
    console.error('Image extraction error:', error);
    throw new Error(`Failed to extract text from image: ${error.message}. The image may be corrupted, too large, or image understanding models may not be available in your Cloudflare Workers AI plan.`);
  }
}

// Main function that processes any document type - handles the whole pipeline:
// extract text, chunk it, create embeddings, store in Vectorize. This is what
// gets called when someone uploads a file or pastes a URL
export async function processDocument(source, type, fileData, env) {
  try {
    let text = '';
    
    // Extract text based on type
    if (type === 'url') {
      console.log(`📥 Fetching text from URL: ${source}`);
      text = await extractTextFromURL(source);
    } else if (type === 'pdf') {
      console.log(`📄 Extracting text from PDF: ${source}`);
      if (!fileData || fileData.byteLength === 0) {
        throw new Error('PDF file is empty or invalid');
      }
      text = await extractTextFromPDF(fileData);
    } else if (type === 'text') {
      // Direct text content (for .txt files)
      console.log(`📝 Using text content directly`);
      text = source;
    } else if (type === 'image') {
      console.log(`🖼️ Extracting text from image: ${source}`);
      if (!fileData || fileData.byteLength === 0) {
        throw new Error('Image file is empty or invalid');
      }
      try {
        text = await extractTextFromImage(fileData, env);
        console.log(`✅ Image description extracted: ${text.length} characters`);
        
        // Validate that we got a meaningful description (not just an error message)
        if (!text || text.trim().length < 20) {
          throw new Error('Image description is too short or empty. The vision model may not have processed the image correctly.');
        }
        
        // Add a prefix to indicate this is image content (helps with filtering later)
        text = `[IMAGE DESCRIPTION] ${text}`;
      } catch (imageError) {
        console.error('❌ Image extraction failed:', imageError);
        throw new Error(`Failed to extract description from image: ${imageError.message}. The image may be corrupted, too large, or vision models may not be available.`);
      }
    } else {
      throw new Error(`Unsupported document type: ${type}`);
    }
    
    if (!text || text.trim().length === 0) {
      throw new Error('No text extracted from document. The document may be empty, image-based, or encrypted.');
    }
    
    console.log(`✅ Extracted ${text.length} characters from document`);
    
    // Chunk the text
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error('No chunks created from document text');
    }
    console.log(`📄 Created ${chunks.length} chunks from document`);
    
    // Create embeddings
    console.log(`🔢 Creating embeddings...`);
    const embeddings = await createEmbeddings(chunks, env);
    if (embeddings.length === 0) {
      throw new Error('Failed to create embeddings');
    }
    console.log(`✅ Created ${embeddings.length} embeddings`);
    
    // Check Vectorize availability
    const vectorize = env.VECTORIZE || env.vectorize || env.Vectorize;
    if (!vectorize) {
      console.error('Vectorize binding check:', {
        hasVECTORIZE: !!env.VECTORIZE,
        hasvectorize: !!env.vectorize,
        hasVectorize: !!env.Vectorize,
        envKeys: Object.keys(env || {})
      });
      throw new Error('Vectorize binding not available. Please ensure the Vectorize binding is configured in wrangler.toml and restart the dev server with: npm run dev');
    }
    
    // Generate document ID
    const documentId = `${type}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Store in Vectorize
    console.log(`💾 Storing ${chunks.length} chunks in Vectorize...`);
    await storeInVectorize(chunks, embeddings, documentId, env);
    
    return {
      documentId,
      chunks: chunks.length,
      textLength: text.length
    };
  } catch (error) {
    console.error('Error in processDocument:', error);
    throw error;
  }
}

