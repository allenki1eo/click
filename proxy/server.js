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

  // Collect body as Buffer so we can handle both JSON and binary (audio) endpoints
  const chunks = [];
  req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  req.on('end', async () => {
    const bodyBuffer = Buffer.concat(chunks);
    const body = bodyBuffer.toString('utf8'); // string view for JSON endpoints

    try {
      if (pathname === '/chat') {
        await handleChat(body, res);
        return;
      }

      if (pathname === '/tts') {
        await handleTTS(body, res);
        return;
      }

      if (pathname === '/transcribe') {
        await handleTranscribe(bodyBuffer, res);
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

  console.log('[OpenRouter] Routing to OpenRouter');

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

// BigModel.cn (Zhipu AI) chat handler - streaming via proxyRequestStream
async function handleBigModelChat(parsed, res) {
  if (!process.env.BIGMODEL_API_KEY) {
    console.error('[BigModel] BIGMODEL_API_KEY is not set in .env — cannot route to GLM');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'BIGMODEL_API_KEY not configured. Add it to proxy/.env' }));
    return;
  }

  const bigModelBody = JSON.stringify({
    model: parsed.model || 'glm-5v-turbo',
    messages: parsed.messages,
    stream: true,
    max_tokens: parsed.max_tokens ?? 800,
  });

  console.log(`[BigModel] Routing to BigModel.cn — model=${parsed.model || 'glm-5v-turbo'}`);

  const options = {
    hostname: 'open.bigmodel.cn',
    path: '/api/paas/v4/chat/completions',
    method: 'POST',
    protocol: 'https:',
    headers: {
      'Authorization': `Bearer ${process.env.BIGMODEL_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bigModelBody),
    }
  };

  try {
    await proxyRequestStream(options, bigModelBody, res);
  } catch (err) {
    console.error('[BigModel] Stream error:', err.message);
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

// Full transcription pipeline — upload audio, submit job, poll until done
// The client POSTs raw audio bytes; the proxy handles all AssemblyAI API calls
// using the server-side API key. This avoids exposing the key to the client and
// fixes the previous bug where a streaming v3 token was incorrectly used for the
// batch v2 REST API (they are completely different auth systems).
async function handleTranscribe(audioBuffer, res) {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    console.error('[transcribe] ASSEMBLYAI_API_KEY is not set — cannot transcribe');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ASSEMBLYAI_API_KEY not configured. Add it to proxy/.env' }));
    return;
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No audio data received', text: '' }));
    return;
  }

  console.log(`[transcribe] Received ${audioBuffer.length} bytes of audio`);

  try {
    // Step 1: Upload audio to AssemblyAI
    const uploadResult = await proxyRequest({
      hostname: 'api.assemblyai.com',
      path: '/v2/upload',
      method: 'POST',
      protocol: 'https:',
      headers: {
        'Authorization': process.env.ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/octet-stream',
        'Content-Length': audioBuffer.length,
      }
    }, audioBuffer);

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`Upload failed (${uploadResult.status}): ${uploadResult.data}`);
    }
    const { upload_url } = JSON.parse(uploadResult.data);
    console.log('[transcribe] Audio uploaded successfully');

    // Step 2: Submit transcription job
    const txBody = JSON.stringify({ audio_url: upload_url });
    const txResult = await proxyRequest({
      hostname: 'api.assemblyai.com',
      path: '/v2/transcript',
      method: 'POST',
      protocol: 'https:',
      headers: {
        'Authorization': process.env.ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(txBody),
      }
    }, txBody);

    if (txResult.status < 200 || txResult.status >= 300) {
      throw new Error(`Transcript submit failed (${txResult.status}): ${txResult.data}`);
    }
    const { id } = JSON.parse(txResult.data);
    console.log('[transcribe] Job submitted, ID:', id);

    // Step 3: Poll until completed (max 20 × 1.5s = 30s)
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const pollResult = await proxyRequest({
        hostname: 'api.assemblyai.com',
        path: `/v2/transcript/${id}`,
        method: 'GET',
        protocol: 'https:',
        headers: { 'Authorization': process.env.ASSEMBLYAI_API_KEY }
      });

      const data = JSON.parse(pollResult.data);
      if (data.status === 'completed') {
        const text = data.text?.trim() ?? '';
        console.log('[transcribe] Completed:', text || '(empty)');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
        return;
      }
      if (data.status === 'error') {
        throw new Error(`AssemblyAI error: ${data.error}`);
      }
      console.log(`[transcribe] Status: ${data.status} (${i + 1}/20)`);
    }

    throw new Error('Transcription timed out after 30s');
  } catch (err) {
    console.error('[transcribe] FAILED:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, text: '' }));
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

server.listen(PORT, () => {
  console.log(`Mwongozo proxy server running on http://localhost:${PORT}`);
  console.log('');
  console.log('AI Provider (at least one required):');
  console.log('  - OPENROUTER_API_KEY - For OpenRouter models');
  console.log('  - BIGMODEL_API_KEY - For BigModel.cn (GLM-5V-Turbo)');
  console.log('');
  console.log('Other services:');
  console.log('  - ELEVENLABS_API_KEY - For text-to-speech');
  console.log('  - ELEVENLABS_VOICE_ID (optional, defaults to 21m00Tcm4TlvDq8ikWAM)');
  console.log('  - ASSEMBLYAI_API_KEY - For voice transcription (POST /transcribe)');
  console.log('');
  console.log('Copy proxy/.env.example to proxy/.env and fill in your API keys.');
});
