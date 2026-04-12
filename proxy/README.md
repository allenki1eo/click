# Mwongozo Proxy Server

This is a simple local proxy server that forwards requests from the Mwongozo desktop app to the AI services (OpenRouter, ElevenLabs, AssemblyAI).

## Why a Proxy?

The proxy keeps your API keys secure on the server side. The desktop app never has direct access to your API keys.

## Quick Start

1. **Copy the environment template:**
   ```
   copy .env.example .env
   ```

2. **Edit `.env` and add your API keys:**
   - Get OpenRouter key: https://openrouter.ai/keys
   - Get ElevenLabs key: https://elevenlabs.io/app/settings/api
   - Get AssemblyAI key: https://www.assemblyai.com/app

3. **Start the proxy server:**
   ```
   node server.js
   ```

4. **Keep the proxy running** while you use the Mwongozo desktop app.

## Alternative: Cloudflare Worker

If you prefer, you can deploy this as a Cloudflare Worker instead of running it locally:

1. Install Wrangler: `npm install -g wrangler`
2. Login: `wrangler login`
3. Set secrets:
   ```
   wrangler secret put OPENROUTER_API_KEY
   wrangler secret put ELEVENLABS_API_KEY
   wrangler secret put ELEVENLABS_VOICE_ID
   wrangler secret put ASSEMBLYAI_API_KEY
   ```
4. Deploy: `wrangler deploy`
5. Update the desktop app config to point to your worker URL

## Troubleshooting

**"Connection refused" error in desktop app:**
- Make sure the proxy server is running (`node server.js`)
- Check that the proxy URL in the desktop app matches (default: http://localhost:8787)

**"Unauthorized" errors:**
- Check that your API keys are correct in the `.env` file
- Make sure you have credits in your OpenRouter/ElevenLabs/AssemblyAI accounts
