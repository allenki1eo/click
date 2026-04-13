/**
 * Mwongozo Proxy Server
 * Supports multiple AI providers: OpenRouter AND BigModel.cn (Zhipu AI)
 *
 * Usage: node server.js
 * Port: 8787
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');

// Load environment variables from .env file if it exists
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.substring(0, idx).trim();
      const value = line.substring(idx + 1).trim();
      if (key && value) process.env[key] = value;
    }
  });
} catch (e) {
  // No .env file, rely on environment variables
}

const PORT = 8787;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function proxyRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function proxyRequestStream(options, postData, res) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    const upstreamReq = client.request(options, (upstreamRes) => {
      // Forward status and headers
      res.writeHead(upstreamRes.statusCode, {
        ...CORS_HEADERS,
        'Content-Type': upstreamRes.headers['content-type'] || 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      // Pipe the response directly
      upstreamRes.pipe(res);
      upstreamRes.on('end', resolve);
    });
    upstreamReq.on('error', reject);
    if (postData) upstreamReq.write(postData);
    upstreamReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  // Set CORS headers
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const pathname = url.parse(req.url).pathname;
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      if (pathname === '/chat') {
        await handleChat(body, res);
        return;
      }

      if (pathname === '/tts') {
        await handleTTS(body, res);
        return;
      }

      if (pathname === '/transcribe-token') {
        await handleTranscribeToken(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      console.error(`[${pathname}] Error:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

// Handle chat requests - route to appropriate provider
async function handleChat(body, res) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const model = parsed.model || '';

  // Route to BigModel.cn for GLM models
  if (model.includes('glm') || model.includes('bigmodel')) {
    await handleBigModelChat(parsed, res);
  } else {
    // Default to OpenRouter
    await handleOpenRouterChat(body, res);
  }
}

// OpenRouter chat handler
async function handleOpenRouterChat(body, res) {
  if (!process.env.OPENROUTER_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }));
    return;
  }

  const options = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    protocol: 'https:',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/allenki1eo/click',
      'X-Title': 'Mwongozo',
    }
  };

  try {
    await proxyRequestStream(options, body, res);
  } catch (err) {
    console.error('[OpenRouter] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

// BigModel.cn (Zhipu AI) chat handler
async function handleBigModelChat(parsed, res) {
  if (!process.env.BIGMODEL_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'BIGMODEL_API_KEY not configured' }));
    return;
  }

  const bigModelBody = JSON.stringify({
    model: parsed.model || 'glm-5v-turbo',
    messages: parsed.messages,
    stream: parsed.stream ?? true,
    thinking: { type: 'enabled' },
    max_tokens: parsed.max_tokens ?? 1024,
  });

  const options = {
    hostname: 'open.bigmodel.cn',
    path: '/api/paas/v4/chat/completions',
    method: 'POST',
    protocol: 'https:',
    headers: {
      'Authorization': `Bearer ${process.env.BIGMODEL_API_KEY}`,
      'Content-Type': 'application/json',
    }
  };

  try {
    const upstream = await proxyRequest(options, bigModelBody);

    if (upstream.status >= 200 && upstream.status < 300) {
      // Check if it's a streaming response
      const contentType = upstream.headers['content-type'] || '';

      if (contentType.includes('text/event-stream')) {
        // Streaming response - pass through
        res.writeHead(200, {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(upstream.data);
      } else {
        // Non-streaming - parse and wrap in SSE format
        const json = JSON.parse(upstream.data);
        const content = json.choices?.[0]?.message?.content || '';

        // Wrap in SSE format for compatibility
        res.writeHead(200, {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });

        // Send as SSE
        const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}

data: [DONE]

`;
        res.end(sseData);
      }
    } else {
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.data);
    }
  } catch (err) {
    console.error('[BigModel] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

// TTS handler
async function handleTTS(body, res) {
  const { text, voiceId } = JSON.parse(body);
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

  const options = {
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${voice}`,
    method: 'POST',
    protocol: 'https:',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    }
  };

  const ttsBody = JSON.stringify({
    text,
    model_id: 'eleven_flash_v2_5',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });

  const upstream = await proxyRequest(options, ttsBody);
  res.writeHead(upstream.status, { 'Content-Type': 'audio/mpeg' });
  res.end(Buffer.from(upstream.data, 'binary'));
}

// Transcribe token handler
async function handleTranscribeToken(res) {
  console.log('[transcribe-token] Checking ASSEMBLYAI_API_KEY...');
  
  if (!process.env.ASSEMBLYAI_API_KEY) {
    console.error('[transcribe-token] ERROR: ASSEMBLYAI_API_KEY is not set!');
    console.error('[transcribe-token] Please add ASSEMBLYAI_API_KEY to your .env file');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'ASSEMBLYAI_API_KEY not configured',
      message: 'Add ASSEMBLYAI_API_KEY to proxy/.env file. Get one at https://www.assemblyai.com/app'
    }));
    return;
  }

  console.log('[transcribe-token] Requesting token from AssemblyAI...');
  console.log('[transcribe-token] API Key (first 8 chars):', process.env.ASSEMBLYAI_API_KEY.substring(0, 8) + '...');

  const options = {
    hostname: 'streaming.assemblyai.com',
    path: '/v3/token?expires_in_seconds=480',
    method: 'GET',
    protocol: 'https:',
    headers: {
      'Authorization': process.env.ASSEMBLYAI_API_KEY,
    }
  };

  try {
    const upstream = await proxyRequest(options);
    console.log('[transcribe-token] AssemblyAI response status:', upstream.status);
    
    if (upstream.status >= 200 && upstream.status < 300) {
      console.log('[transcribe-token] Token obtained successfully');
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.data);
    } else {
      console.error('[transcribe-token] ERROR: AssemblyAI returned', upstream.status);
      console.error('[transcribe-token] Response:', upstream.data);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: `AssemblyAI error ${upstream.status}`,
        details: upstream.data,
        message: 'Check your ASSEMBLYAI_API_KEY is valid'
      }));
    }
  } catch (err) {
    console.error('[transcribe-token] ERROR:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: err.message,
      message: 'Failed to connect to AssemblyAI'
    }));
  }
}

server.listen(PORT, () => {
  console.log(`Mwongozo proxy server running on http://localhost:${PORT}`);
  console.log('');
  console.log('AI Provider (at least one required):');
  console.log('  - OPENROUTER_API_KEY - For OpenRouter models');
  console.log('  - BIGMODEL_API_KEY - For BigModel.cn (GLM-5V-Turbo)');
  console.log('');
  console.log('Other services:');
  console.log('  - ELEVENLABS_API_KEY');
  console.log('  - ELEVENLABS_VOICE_ID (optional, defaults to 21m00Tcm4TlvDq8ikWAM)');
  console.log('  - ASSEMBLYAI_API_KEY');
  console.log('');
  console.log('You can create a .env file in the proxy folder with these values.');
});
