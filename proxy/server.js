/**
 * Mwongozo Proxy Server — Multi-tenant edition
 * Supports TRA, BRELA, CRDB, NMB and any custom org.
 *
 * Usage: node server.js
 * Port: 8787
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const analytics = require('./analytics');
const rag       = require('./rag');

// Load .env
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.substring(0, idx).trim();
      const value = line.substring(idx + 1).trim();
      if (key && value) process.env[key] = value;
    }
  });
} catch (e) { /* rely on env vars */ }

const PORT = process.env.PORT || 8787;
const ORGS_DIR = path.join(__dirname, 'orgs');

// Cache loaded org configs
const orgCache = new Map();

function loadOrg(orgId) {
  if (!orgId) return null;
  const safe = orgId.replace(/[^a-z0-9_-]/gi, '');
  if (orgCache.has(safe)) return orgCache.get(safe);
  try {
    const file = path.join(ORGS_DIR, `${safe}.json`);
    const org = JSON.parse(fs.readFileSync(file, 'utf8'));
    orgCache.set(safe, org);
    return org;
  } catch (e) {
    return null;
  }
}

function corsHeaders(origin, org) {
  const allowed = org?.allowedOrigins ?? [];
  const originOk = !origin || allowed.length === 0 ||
    allowed.some(o => origin.includes(o));

  return {
    'Access-Control-Allow-Origin': originOk ? (origin || '*') : '',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Org-Id, X-Admin-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

function proxyRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode,
        data: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function proxyRequestStream(options, postData, res, origin, org) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    const upstreamReq = client.request(options, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, {
        ...corsHeaders(origin, org),
        'Content-Type': upstreamRes.headers['content-type'] || 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      upstreamRes.pipe(res);
      upstreamRes.on('end', resolve);
    });
    upstreamReq.on('error', reject);
    if (postData) upstreamReq.write(postData);
    upstreamReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'] || '';
  const orgId = req.headers['x-org-id'] || '';
  const org = loadOrg(orgId);
  const cors = corsHeaders(origin, org);

  Object.entries(cors).forEach(([k, v]) => v && res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = url.parse(req.url).pathname;

  // GET /config — return org branding for widget initialization
  if (req.method === 'GET' && pathname === '/config') {
    const qOrg = url.parse(req.url, true).query.org || orgId;
    const cfg = loadOrg(qOrg);
    if (!cfg) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown org' }));
      return;
    }
    // Return only public fields (not full system prompt)
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: cfg.id,
      name: cfg.name,
      fullName: cfg.fullName,
      theme: cfg.theme,
      language: cfg.language,
      welcomeMessage: cfg.welcomeMessage,
      suggestedQuestions: cfg.suggestedQuestions,
    }));
    return;
  }

  // Health check (no body needed)
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
    return;
  }

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  req.on('end', async () => {
    const bodyBuffer = Buffer.concat(chunks);
    const body = bodyBuffer.toString('utf8');

    try {
      if (pathname === '/chat') {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        await handleChat(body, res, org, req);
        return;
      }
      if (pathname === '/detect') {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        await handleComputerUseDetect(body, res);
        return;
      }
      if (pathname === '/tts') {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        await handleTTS(body, res, org);
        return;
      }
      if (pathname === '/transcribe') {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        await handleTranscribe(bodyBuffer, res);
        return;
      }
      if (pathname === '/log') {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        await handleLog(body, res, org);
        return;
      }
      if (pathname === '/admin/analytics') {
        await handleAdminAnalytics(req, res, org);
        return;
      }
      if (pathname === '/admin/conversations') {
        await handleAdminConversations(req, res, org);
        return;
      }
      if (pathname === '/admin/knowledge') {
        await handleAdminKnowledge(req, res, body, org);
        return;
      }
      if (pathname === '/admin/documents') {
        await handleAdminDocuments(req, res, body, bodyBuffer, org);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      console.error(`[${pathname}] Error:`, err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });
});

// Universal response-format instruction appended to every org system prompt
const RESPONSE_FORMAT_RULES = `

## RESPONSE FORMAT RULES
- For PROCEDURAL questions ("how do I…", "steps to…", "how to…"):
  Reply with a numbered list, one action per step, ≤ 10 words each.
  Example: "1. Click Settings  2. Go to Privacy  3. Enable the toggle"
- For FACTUAL or CONCEPTUAL questions: answer in 1–2 concise sentences.
- For ERRORS / TROUBLESHOOTING: state the cause (1 sentence) then numbered fixes.
- Never start with "Sure", "Of course", "Certainly" or similar filler.
- Keep language simple and direct. Prefer active voice.`;

// Inject org system prompt + role context + RAG chunks into messages
function injectOrgContext(messages, org, userRole, ragChunks) {
  let systemContent = (org?.systemPrompt || '') + RESPONSE_FORMAT_RULES;

  // Role-specific addendum
  if (userRole && org?.roles?.[userRole]) {
    systemContent += `\n\n## USER ROLE\n${org.roles[userRole]}`;
  }

  // RAG retrieved passages
  if (ragChunks?.length > 0) {
    systemContent += '\n\n## RELEVANT DOCUMENTATION (retrieved for this query)\n';
    ragChunks.forEach(c => {
      systemContent += `\n[Source: ${c.filename}]\n${c.text}\n`;
    });
    systemContent += '\nUse the above documentation passages to give accurate, specific answers.';
  }

  if (messages[0]?.role === 'system') {
    return [
      { role: 'system', content: `${systemContent}\n\n---\n\n${messages[0].content}` },
      ...messages.slice(1),
    ];
  }
  return [{ role: 'system', content: systemContent }, ...messages];
}

async function handleChat(body, res, org, req) {
  let parsed;
  try { parsed = JSON.parse(body); } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  // Resolve user role (from X-User-Role header or message body)
  const userRole = req?.headers['x-user-role'] || parsed.userRole || null;

  // RAG: retrieve relevant chunks for the user's query
  let ragChunks = [];
  if (org?.id && rag.hasDocuments(org.id)) {
    const lastUserMsg = [...(parsed.messages || [])].reverse().find(m => m.role === 'user');
    if (lastUserMsg?.content) {
      ragChunks = rag.search(org.id, lastUserMsg.content, 5);
    }
  }

  // Inject org knowledge + role context + RAG into messages
  if (org) {
    parsed.messages = injectOrgContext(parsed.messages || [], org, userRole, ragChunks);
  }

  const model = parsed.model || '';

  const origin = req?.headers['origin'] || '';

  if (model.includes('glm') || model.includes('bigmodel')) {
    await handleBigModelChat(parsed, res, origin, org);
  } else if (model.startsWith('claude-') && process.env.ANTHROPIC_API_KEY) {
    // Direct Anthropic API — used when desktop sends a claude-* model name
    // and the key is configured; avoids OpenRouter markup & rate limits.
    await handleAnthropicChat(parsed, res, origin, org);
  } else {
    await handleOpenRouterChat(JSON.stringify(parsed), res, origin, org);
  }
}

async function handleOpenRouterChat(body, res, origin, org) {
  if (!process.env.OPENROUTER_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }));
    return;
  }

  console.log('[OpenRouter] Routing chat request');

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
    await proxyRequestStream(options, body, res, origin, org);
  } catch (err) {
    console.error('[OpenRouter] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

async function handleBigModelChat(parsed, res, origin, org) {
  if (!process.env.BIGMODEL_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'BIGMODEL_API_KEY not configured' }));
    return;
  }

  const bigModelBody = JSON.stringify({
    model: parsed.model || 'glm-5v-turbo',
    messages: parsed.messages,
    stream: true,
    max_tokens: parsed.max_tokens ?? 800,
  });

  console.log(`[BigModel] model=${parsed.model || 'glm-5v-turbo'}`);

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
    await proxyRequestStream(options, bigModelBody, res, origin, org);
  } catch (err) {
    console.error('[BigModel] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

// ---------------------------------------------------------------------------
// Direct Anthropic chat (SSE streaming) — used when model is a claude-* name
// and ANTHROPIC_API_KEY is set.  Converts OpenAI-compatible image_url content
// blocks to Anthropic's native image source format before forwarding.
// ---------------------------------------------------------------------------

async function handleAnthropicChat(parsed, res, origin, org) {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }));
    return;
  }

  // Convert OpenAI-style image_url blocks → Anthropic image source blocks
  const convertMessages = (msgs) => msgs.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((block) => {
        if (block.type === 'image_url') {
          const url = block.image_url?.url || '';
          const b64 = url.includes(',') ? url.split(',')[1] : url;
          const mediaType = url.startsWith('data:') ? url.slice(5, url.indexOf(';')) : 'image/jpeg';
          return { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } };
        }
        return block;
      }),
    };
  });

  const anthropicBody = JSON.stringify({
    model:      parsed.model || 'claude-haiku-4-5-20251001',
    max_tokens: parsed.max_tokens ?? 1200,
    stream:     true,
    messages:   convertMessages(parsed.messages || []),
  });

  console.log(`[Anthropic] model=${parsed.model || 'claude-haiku-4-5-20251001'}`);

  // Anthropic SSE format differs from OpenAI — but we re-emit it as OpenAI
  // so the client-side SSE reader doesn't need changes.
  return new Promise((resolve, reject) => {
    const req = require('https').request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
    }, (upstream) => {
      res.writeHead(upstream.statusCode, {
        ...corsHeaders(origin, org),
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      let buf = '';
      upstream.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]' || !raw) continue;
            try {
              const evt = JSON.parse(raw);
              // content_block_delta → emit as OpenAI delta format
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                const openAiLike = { choices: [{ delta: { content: evt.delta.text } }] };
                res.write(`data: ${JSON.stringify(openAiLike)}\n\n`);
              } else if (evt.type === 'message_stop') {
                res.write('data: [DONE]\n\n');
              }
            } catch { /* skip malformed */ }
          }
        }
      });

      upstream.on('end', () => { res.end(); resolve(); });
      upstream.on('error', reject);
    });

    req.on('error', reject);
    req.write(anthropicBody);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// /detect — Claude Computer Use API: given a screenshot + question, returns
// the pixel coordinates of the most relevant UI element to click.
// Returns {x, y} (display coordinates) or {x:null, y:null} if not found.
// ---------------------------------------------------------------------------

async function handleComputerUseDetect(body, res) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    // Key not configured — caller will fall back to POINT tags from vision model
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ x: null, y: null }));
    return;
  }

  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const {
    screenshotBase64, userQuestion,
    displayWidth, displayHeight,
    cuWidth, cuHeight, appContext,
  } = parsed;

  const w = cuWidth  || displayWidth  || 1280;
  const h = cuHeight || displayHeight || 800;

  const contextLine = appContext ? `Active application: ${appContext}\n` : '';

  const requestBody = JSON.stringify({
    model:      'claude-sonnet-4-6',
    max_tokens: 512,
    tools: [{
      type:               'computer_20250124',
      name:               'computer',
      display_width_px:   w,
      display_height_px:  h,
    }],
    messages: [{
      role: 'user',
      content: [
        {
          type:   'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 },
        },
        {
          type: 'text',
          text: `${contextLine}The user asked: "${userQuestion}"\n\n` +
                `Identify the single most relevant UI element to click in order to help with this task. ` +
                `Use the computer tool to move the mouse to that element. ` +
                `If no specific clickable element applies (e.g. purely informational question), do NOT use the tool.`,
        },
      ],
    }],
  });

  console.log('[detect] Calling Anthropic Computer Use for:', userQuestion?.slice(0, 60));

  try {
    const result = await proxyRequest({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      protocol: 'https:',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'computer-use-2025-01-24',
        'content-type':      'application/json',
      },
    }, requestBody);

    if (result.status !== 200) {
      console.warn('[detect] Anthropic error', result.status, result.data.slice(0, 200));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ x: null, y: null }));
      return;
    }

    const data = JSON.parse(result.data);

    // Find the first tool_use block with a coordinate action
    let x = null, y = null;
    for (const block of data.content || []) {
      if (block.type === 'tool_use' && block.name === 'computer') {
        const coord = block.input?.coordinate;
        if (Array.isArray(coord) && coord.length === 2) {
          // Scale from CU resolution back to display resolution
          const scaleX = (displayWidth  || w) / w;
          const scaleY = (displayHeight || h) / h;
          x = Math.round(coord[0] * scaleX);
          y = Math.round(coord[1] * scaleY);
          console.info(`[detect] Computer Use → CU(${coord[0]},${coord[1]}) → display(${x},${y})`);
          break;
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ x, y }));

  } catch (err) {
    console.error('[detect] Error:', err.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ x: null, y: null }));
  }
}

async function handleTTS(body, res, org) {
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

async function handleTranscribe(audioBuffer, res) {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ASSEMBLYAI_API_KEY not configured' }));
    return;
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No audio data', text: '' }));
    return;
  }

  console.log(`[transcribe] ${audioBuffer.length} bytes`);

  try {
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

    if (uploadResult.status < 200 || uploadResult.status >= 300)
      throw new Error(`Upload failed (${uploadResult.status})`);

    const { upload_url } = JSON.parse(uploadResult.data);

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

    if (txResult.status < 200 || txResult.status >= 300)
      throw new Error(`Transcript submit failed (${txResult.status})`);

    const { id } = JSON.parse(txResult.data);
    console.log('[transcribe] Job ID:', id);

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
        console.log('[transcribe] Done:', text || '(empty)');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
        return;
      }
      if (data.status === 'error') throw new Error(`AssemblyAI: ${data.error}`);
    }
    throw new Error('Transcription timed out');
  } catch (err) {
    console.error('[transcribe] FAILED:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, text: '' }));
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// POST /log — widget fires this on every user/assistant message
async function handleLog(body, res, org) {
  try {
    const { role, text, page, lang, sessionId } = JSON.parse(body);
    if (org?.id && role && text) {
      analytics.logMessage(org.id, sessionId || 'anon', role, text, { page, lang });
    }
    res.writeHead(204); res.end();
  } catch (_) {
    res.writeHead(400); res.end();
  }
}

// GET /admin/analytics?org=tra — summary stats for the dashboard
async function handleAdminAnalytics(req, res, org) {
  if (!requireAdmin(req, res)) return;
  const qOrg = url.parse(req.url, true).query.org || org?.id;
  if (!qOrg) { res.writeHead(400, json); res.end(JSON.stringify({ error: 'org required' })); return; }
  const summary = analytics.getSummary(qOrg);
  res.writeHead(200, json);
  res.end(JSON.stringify(summary));
}

// GET /admin/conversations?org=tra&limit=50
async function handleAdminConversations(req, res, org) {
  if (!requireAdmin(req, res)) return;
  const q = url.parse(req.url, true).query;
  const qOrg = q.org || org?.id;
  const limit = parseInt(q.limit) || 50;
  if (!qOrg) { res.writeHead(400, json); res.end(JSON.stringify({ error: 'org required' })); return; }
  const convos = analytics.getRecentConversations(qOrg, limit);
  res.writeHead(200, json);
  res.end(JSON.stringify(convos));
}

// GET/POST /admin/knowledge?org=tra — read or update org knowledge base
async function handleAdminKnowledge(req, res, body, org) {
  if (!requireAdmin(req, res)) return;
  const qOrg = url.parse(req.url, true).query.org || org?.id;
  if (!qOrg) { res.writeHead(400, json); res.end(JSON.stringify({ error: 'org required' })); return; }

  const safe = qOrg.replace(/[^a-z0-9_-]/gi, '');
  const filePath = path.join(ORGS_DIR, `${safe}.json`);

  if (req.method === 'GET') {
    try {
      const cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.writeHead(200, json);
      res.end(JSON.stringify({ systemPrompt: cfg.systemPrompt, welcomeMessage: cfg.welcomeMessage }));
    } catch (_) {
      res.writeHead(404, json); res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  // POST — update knowledge
  try {
    const { systemPrompt, welcomeMessage } = JSON.parse(body);
    const cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (systemPrompt)    cfg.systemPrompt    = systemPrompt;
    if (welcomeMessage)  cfg.welcomeMessage  = welcomeMessage;
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2));
    // Clear org from cache so it reloads
    orgCache.delete(safe);
    res.writeHead(200, json);
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, json); res.end(JSON.stringify({ error: e.message }));
  }
}

const json = { 'Content-Type': 'application/json' };

// GET /admin/documents?org= — list documents
// POST /admin/documents?org= — upload new document (text body or JSON {filename, text})
// DELETE /admin/documents?org=&id= — remove document
async function handleAdminDocuments(req, res, body, bodyBuffer, org) {
  if (!requireAdmin(req, res)) return;
  const q    = url.parse(req.url, true).query;
  const qOrg = q.org || org?.id;
  if (!qOrg) { res.writeHead(400, json); res.end(JSON.stringify({ error: 'org required' })); return; }

  if (req.method === 'GET') {
    const docs = rag.listDocuments(qOrg);
    res.writeHead(200, json);
    res.end(JSON.stringify(docs));
    return;
  }

  if (req.method === 'DELETE') {
    const docId = q.id;
    if (!docId) { res.writeHead(400, json); res.end(JSON.stringify({ error: 'id required' })); return; }
    rag.removeDocument(qOrg, docId);
    res.writeHead(200, json); res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST — upload document
  try {
    const ct = req.headers['content-type'] || '';
    let filename, text;

    if (ct.includes('application/json')) {
      ({ filename, text } = JSON.parse(body));
    } else {
      // Plain text upload — filename from Content-Disposition header or query param
      filename = q.filename || req.headers['x-filename'] || 'document.txt';
      text     = bodyBuffer.toString('utf8');
    }

    if (!text?.trim()) throw new Error('Empty document');

    const docId = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    rag.addDocument(qOrg, docId, filename || 'document.txt', text);

    const docs = rag.listDocuments(qOrg);
    const doc  = docs.find(d => d.id === docId);
    console.log(`[rag] ${qOrg}: added "${filename}" → ${doc?.chunks} chunks`);

    res.writeHead(200, json);
    res.end(JSON.stringify({ ok: true, id: docId, chunks: doc?.chunks }));
  } catch (e) {
    res.writeHead(400, json); res.end(JSON.stringify({ error: e.message }));
  }
}

function requireAdmin(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return true; // no secret set → open (dev mode)
  const provided = req.headers['x-admin-secret'] || url.parse(req.url, true).query.secret;
  if (provided !== secret) {
    res.writeHead(401, json);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

server.listen(PORT, () => {
  console.log(`\nMwongozo proxy — http://localhost:${PORT}`);
  console.log(`Orgs loaded from: ${ORGS_DIR}`);
  const orgs = fs.readdirSync(ORGS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  console.log(`Available orgs: ${orgs.join(', ')}`);
  console.log('\nRequired env vars: OPENROUTER_API_KEY or BIGMODEL_API_KEY');
  console.log('Optional: ELEVENLABS_API_KEY, ASSEMBLYAI_API_KEY\n');
});
