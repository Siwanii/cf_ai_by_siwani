// ok so this searches the web when the AI needs current info
// took me forever to get the API working properly 

export async function webSearch(query, env) {
  try {
    console.log(`🔍 Web search for: "${query}"`);
    
    // Use DuckDuckGo Instant Answer API (free, no API key needed)
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );
    
    if (!response.ok) {
      throw new Error(`Search API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract the most relevant information
    let results = '';
    
    // Priority 1: Abstract (direct answer)
    if (data.Abstract && data.Abstract.trim()) {
      results += `**Answer**: ${data.Abstract}\n`;
      if (data.AbstractURL) {
        results += `**Source**: ${data.AbstractURL}\n`;
      }
    }
    
    // Priority 2: Related Topics (additional context)
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const topics = data.RelatedTopics
        .filter(topic => topic.Text && topic.Text.trim())
        .slice(0, 3)
        .map(topic => `- ${topic.Text}`)
        .join('\n');
      
      if (topics) {
        results += `\n**Related Information**:\n${topics}\n`;
      }
    }
    
    // Priority 3: Definition (for entity queries)
    if (data.Definition && data.Definition.trim()) {
      results += `\n**Definition**: ${data.Definition}\n`;
      if (data.DefinitionURL) {
        results += `**Source**: ${data.DefinitionURL}\n`;
      }
    }
    
    // If no results found, return a message
    if (!results.trim()) {
      return {
        success: false,
        error: 'No results found',
        message: `No current information found for "${query}".`
      };
    }
    
    console.log(`✅ Web search successful`);
    return {
      success: true,
      results: results.trim(),
      query: query,
      source: 'DuckDuckGo'
    };
    
  } catch (error) {
    console.error('❌ Web search error:', error);
    return {
      success: false,
      error: error.message,
      message: `Web search failed: ${error.message}`
    };
  }
}