// Available functions that the AI can call
//Format follows OpenAI function calling schema for compatibility

export const AVAILABLE_FUNCTIONS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather information for a specific location. Use this when users ask about weather conditions.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city name or location (e.g., "San Francisco", "New York", "London")'
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit preference',
            default: 'celsius'
          }
        },
        required: ['location']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Perform mathematical calculations. Use this when users ask to calculate, compute, or solve math problems.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The mathematical expression to evaluate (e.g., "2 + 2", "10 * 5", "sqrt(16)")'
          }
        },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current date and time. Use this when users ask about the current time, date, or what day it is.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Optional timezone (e.g., "America/New_York", "Europe/London", "Asia/Tokyo"). Defaults to UTC if not specified.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for information. Use this when users ask about current events, recent news, acquisitions, mergers, company deals, or any information that may require up-to-date data. Always use this for questions about recent business news, acquisitions, or 2025/2026 information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query or question to look up'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'convert_currency',
      description: 'Convert between different currencies. Use this when users ask about currency conversion or exchange rates.',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: 'The amount to convert'
          },
          from: {
            type: 'string',
            description: 'Source currency code (e.g., "USD", "EUR", "GBP")'
          },
          to: {
            type: 'string',
            description: 'Target currency code (e.g., "USD", "EUR", "GBP")'
          }
        },
        required: ['amount', 'from', 'to']
      }
    }
  }
];

// When the AI decides to use a tool, this function actually runs it
// I made it a switch statement because it's cleaner than a bunch of if/else
export async function executeFunction(functionName, args) {

  switch (functionName) {
    case 'get_weather':
      return await getWeather(args.location, args.unit || 'celsius');
    
    case 'calculate':
      return await calculate(args.expression);
    
    case 'get_current_time':
      return await getCurrentTime(args.timezone);
    
    case 'search_web':
      return await searchWeb(args.query);
    
    case 'convert_currency':
      return await convertCurrency(args.amount, args.from, args.to);
    
    default:
      throw new Error(`Unknown function: ${functionName}`);
  }
}

// Gets the weather - right now it's using mock data since I didn't want to deal
// with API keys, but you could easily swap this out for OpenWeatherMap or similar
async function getWeather(location, unit = 'celsius') {
  // Mock weather data - In production, call a real API like OpenWeatherMap
  const mockWeather = {
    'san francisco': { temp: 18, condition: 'Partly Cloudy', humidity: 65 },
    'new york': { temp: 22, condition: 'Sunny', humidity: 55 },
    'london': { temp: 15, condition: 'Rainy', humidity: 80 },
    'tokyo': { temp: 25, condition: 'Clear', humidity: 60 },
    'paris': { temp: 20, condition: 'Cloudy', humidity: 70 }
  };

  const locationKey = location.toLowerCase();
  const weather = mockWeather[locationKey] || {
    temp: Math.floor(Math.random() * 30) + 10,
    condition: ['Sunny', 'Cloudy', 'Partly Cloudy', 'Rainy'][Math.floor(Math.random() * 4)],
    humidity: Math.floor(Math.random() * 40) + 40
  };

  let temperature = weather.temp;
  if (unit === 'fahrenheit') {
    temperature = (temperature * 9/5) + 32;
  }

  return {
    location: location,
    temperature: Math.round(temperature),
    unit: unit,
    condition: weather.condition,
    humidity: weather.humidity,
    note: 'This is mock data. In production, this would call a real weather API.'
  };
}

// Does math stuff - I sanitize the input first because you can't trust user input
// In production you'd want a proper math parser library, but this works for now
async function calculate(expression) {
  try {
    // Sanitize expression to only allow safe math operations
    const sanitized = expression.replace(/[^0-9+\-*/().\s,sqrt,sin,cos,tan,log,pi,e]/gi, '');
    
    // Use Function constructor for safe evaluation (still be cautious in production)
    // For production, consider using a proper math parser library
    const result = Function(`"use strict"; return (${sanitized})`)();
    
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Invalid calculation result');
    }

    return {
      expression: expression,
      result: result,
      formatted: result.toLocaleString()
    };
  } catch (error) {
    return {
      error: `Could not calculate: ${expression}`,
      message: error.message
    };
  }
}

// Returns the current time - pretty straightforward, handles timezones if you give it one
async function getCurrentTime(timezone) {
  try {
    const now = timezone 
      ? new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
      : new Date();

    return {
      datetime: now.toISOString(),
      formatted: now.toLocaleString('en-US', {
        timeZone: timezone || 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }),
      timezone: timezone || 'UTC',
      timestamp: now.getTime()
    };
  } catch (error) {
    return {
      error: 'Could not get current time',
      message: error.message
    };
  }
}

// This is the web search function - I use DuckDuckGo and Wikipedia because they're free
// and don't require API keys. It tries multiple strategies to get good results,
// especially for current events and 2025/2026 information
async function searchWeb(query) {
  try {
    const lowerQuery = query.toLowerCase();
    let results = [];
    let answerText = '';
    
    // Strategy 1: Try DuckDuckGo Instant Answer API
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const ddgResponse = await fetch(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)'
        }
      });
      
      if (ddgResponse.ok) {
        const ddgData = await ddgResponse.json();
        
        // Get abstract/answer if available
        if (ddgData.AbstractText) {
          answerText = ddgData.AbstractText;
          results.push({
            title: ddgData.Heading || ddgData.AbstractSource || 'Information',
            snippet: ddgData.AbstractText,
            url: ddgData.AbstractURL || ''
          });
        }
        
        // Get related topics
        if (ddgData.RelatedTopics && ddgData.RelatedTopics.length > 0) {
          ddgData.RelatedTopics.slice(0, 3).forEach(topic => {
            if (topic.Text) {
              results.push({
                title: topic.Text.split(' - ')[0] || 'Related',
                snippet: topic.Text,
                url: topic.FirstURL || ''
              });
            }
          });
        }
        
        // Get answer from Answer field if available
        if (ddgData.Answer && !answerText) {
          answerText = ddgData.Answer;
          results.push({
            title: 'Answer',
            snippet: ddgData.Answer,
            url: ddgData.AnswerType === 'calc' ? '' : (ddgData.AbstractURL || '')
          });
        }
      }
    } catch (ddgError) {
      console.warn('DuckDuckGo search failed:', ddgError);
    }
    
    // Strategy 2: For specific queries, try Wikipedia API for authoritative information
    if (results.length === 0 || !answerText) {
      try {
        // Extract key terms for Wikipedia search
        const wikiQuery = query.replace(/^(who is|what is|who are|what are)\s+/i, '').trim();
        const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiQuery)}`;
        
        const wikiResponse = await fetch(wikiUrl, {
          headers: {
            'User-Agent': 'CloudflareWorker/1.0'
          }
        });
        
        if (wikiResponse.ok) {
          const wikiData = await wikiResponse.json();
          if (wikiData.extract) {
            const wikiSnippet = wikiData.extract.substring(0, 500);
            if (!answerText) {
              answerText = wikiSnippet;
            }
            results.push({
              title: wikiData.title || 'Wikipedia',
              snippet: wikiSnippet,
              url: wikiData.content_urls?.desktop?.page || ''
            });
          }
        }
      } catch (wikiError) {
        console.warn('Wikipedia search failed:', wikiError);
      }
    }
    
    // Strategy 3: For current events (2025/2026), acquisitions, mergers, or recent news
    const isCurrentEvent = lowerQuery.includes('2025') || 
                           lowerQuery.includes('2026') || 
                           lowerQuery.includes('current') || 
                           lowerQuery.includes('latest') || 
                           lowerQuery.includes('recent') ||
                           lowerQuery.includes('acquisition') ||
                           lowerQuery.includes('merger') ||
                           lowerQuery.includes('buyout') ||
                           lowerQuery.includes('deal');
    
    if (isCurrentEvent && (results.length === 0 || !answerText || answerText.length < 100)) {
      try {
        // Try multiple search variations for better results
        const searchVariations = [];
        
        // Add "2025" or "2026" if not already present
        if (!query.includes('2025') && !query.includes('2026')) {
          searchVariations.push(`${query} 2026`);
          searchVariations.push(`${query} 2025`);
        }
        searchVariations.push(query);
        
        // For acquisition/merger queries, try news-focused variations
        if (lowerQuery.includes('acquisition') || lowerQuery.includes('merger') || lowerQuery.includes('buyout')) {
          searchVariations.push(`${query} news`);
          searchVariations.push(`${query} announcement`);
        }
        
        for (const searchQuery of searchVariations) {
          try {
            const currentUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1&skip_disambig=1`;
            const currentResponse = await fetch(currentUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)'
              }
            });
            
            if (currentResponse.ok) {
              const currentData = await currentResponse.json();
              if (currentData.AbstractText && currentData.AbstractText.length > (answerText?.length || 0)) {
                answerText = currentData.AbstractText;
                results.unshift({
                  title: currentData.Heading || 'Current Information',
                  snippet: currentData.AbstractText,
                  url: currentData.AbstractURL || ''
                });
              }
              
              // Also check RelatedTopics for more information
              if (currentData.RelatedTopics && currentData.RelatedTopics.length > 0) {
                currentData.RelatedTopics.slice(0, 2).forEach(topic => {
                  if (topic.Text && topic.Text.length > 50) {
                    results.push({
                      title: topic.Text.split(' - ')[0] || 'Related',
                      snippet: topic.Text,
                      url: topic.FirstURL || ''
                    });
                  }
                });
              }
            }
          } catch (variationError) {
            continue; // Try next variation
          }
        }
      } catch (currentError) {
        console.warn('Current info search failed:', currentError);
      }
    }
    
    // Strategy 4: For president queries specifically, provide accurate guidance
    if (lowerQuery.includes('president') && (lowerQuery.includes('america') || lowerQuery.includes('united states') || lowerQuery.includes('us'))) {
      if (!answerText || answerText.length < 50) {
        // Try multiple search variations - prioritize 2026, then 2025
        const variations = [
          'president of united states 2026',
          'current US president 2026',
          'who is president of America 2026',
          'president of united states 2025',
          'current US president 2025',
          'who is president of America 2025'
        ];
        
        for (const variation of variations) {
          try {
            const varUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(variation)}&format=json&no_html=1&skip_disambig=1`;
            const varResponse = await fetch(varUrl);
            if (varResponse.ok) {
              const varData = await varResponse.json();
              if (varData.AbstractText && varData.AbstractText.length > answerText.length) {
                answerText = varData.AbstractText;
                results.unshift({
                  title: varData.Heading || 'Current President',
                  snippet: varData.AbstractText,
                  url: varData.AbstractURL || 'https://www.whitehouse.gov'
                });
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }
    }
    
    // Final fallback if no results
    if (results.length === 0) {
      answerText = `I searched for "${query}" but couldn't find specific current information. For the most accurate and up-to-date information, please check official sources or recent news articles.`;
      results.push({
        title: 'Search Information',
        snippet: `For accurate information about "${query}", please refer to official sources or recent news articles.`,
        url: ''
      });
    }
    
    return {
      query: query,
      answer: answerText,
      results: results,
      count: results.length,
      source: 'Multiple Sources (DuckDuckGo, Wikipedia)',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Search error:', error);
    return {
      query: query,
      error: 'Search failed',
      message: `Unable to search the web for "${query}". ${error.message}`,
      results: [],
      count: 0
    };
  }
}

// Currency conversion - also using mock rates for now. You'd want to use a real
// exchange rate API in production, but this is fine for testing
async function convertCurrency(amount, from, to) {
  // Mock exchange rates - In production, call a real API like ExchangeRate-API, Fixer.io, etc.
  const exchangeRates = {
    'USD': { 'EUR': 0.92, 'GBP': 0.79, 'JPY': 150.0, 'CNY': 7.2 },
    'EUR': { 'USD': 1.09, 'GBP': 0.86, 'JPY': 163.0, 'CNY': 7.8 },
    'GBP': { 'USD': 1.27, 'EUR': 1.16, 'JPY': 190.0, 'CNY': 9.1 },
    'JPY': { 'USD': 0.0067, 'EUR': 0.0061, 'GBP': 0.0053, 'CNY': 0.048 },
    'CNY': { 'USD': 0.14, 'EUR': 0.13, 'GBP': 0.11, 'JPY': 20.8 }
  };

  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  if (fromUpper === toUpper) {
    return {
      amount: amount,
      from: fromUpper,
      to: toUpper,
      converted: amount,
      rate: 1.0,
      note: 'Same currency, no conversion needed.'
    };
  }

  const rate = exchangeRates[fromUpper]?.[toUpper];
  if (!rate) {
    return {
      error: `Exchange rate not available for ${fromUpper} to ${toUpper}`,
      note: 'This is mock data. In production, this would call a real currency API.'
    };
  }

  const converted = amount * rate;

  return {
    amount: amount,
    from: fromUpper,
    to: toUpper,
    converted: Math.round(converted * 100) / 100,
    rate: rate,
    note: 'This is mock data. In production, this would call a real currency API with current exchange rates.'
  };
}

