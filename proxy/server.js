/**
 * Simple local proxy server for Mwongozo
 * Forwards requests to OpenRouter, ElevenLabs, and AssemblyAI
 *
 * Usage: node server.js
 * Port: 8787 (same as config)
 */

const http = require('http');
const https = require('https');
const url = require('url');

// Load environment variables from .env file if it exists
try {
  require('fs').readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) process.env[key.trim()] = value.trim();
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
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
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
        // Forward to OpenRouter
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

        const upstream = await proxyRequest(options, body);
        res.writeHead(upstream.status, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.end(upstream.data);
        return;
      }

      if (pathname === '/tts') {
        // Forward to ElevenLabs
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
        return;
      }

      if (pathname === '/transcribe-token') {
        // Forward to AssemblyAI
        const options = {
          hostname: 'streaming.assemblyai.com',
          path: '/v3/token?expires_in_seconds=480',
          method: 'GET',
          protocol: 'https:',
          headers: {
            'Authorization': process.env.ASSEMBLYAI_API_KEY,
          }
        };

        const upstream = await proxyRequest(options);
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(upstream.data);
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

server.listen(PORT, () => {
  console.log(`Mwongozo proxy server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Required environment variables:');
  console.log('  - OPENROUTER_API_KEY');
  console.log('  - ELEVENLABS_API_KEY');
  console.log('  - ELEVENLABS_VOICE_ID (optional, defaults to 21m00Tcm4TlvDq8ikWAM)');
  console.log('  - ASSEMBLYAI_API_KEY');
  console.log('');
  console.log('You can create a .env file in the proxy folder with these values.');
});
