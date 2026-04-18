/**
 * RAG (Retrieval-Augmented Generation) document store.
 *
 * Each org gets its own document collection stored under proxy/data/{orgId}/.
 * Documents are split into overlapping chunks and indexed with TF-IDF so the
 * most relevant passages are injected into the AI's context for each query.
 *
 * No external APIs or vector databases needed — TF-IDF is fast enough for the
 * document volumes these orgs will realistically have (hundreds, not millions).
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, 'data');
const CHUNK_SIZE = 400;   // words per chunk
const CHUNK_OVL  = 80;    // overlap words between consecutive chunks
const TOP_K      = 5;     // chunks to retrieve per query

// In-memory: { orgId: { docs: [...], chunks: [...], idf: {} } }
const stores = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function addDocument(orgId, docId, filename, text) {
  _ensureStore(orgId);
  const store = stores.get(orgId);

  // Remove existing doc with same id
  store.docs   = store.docs.filter(d => d.id !== docId);
  store.chunks = store.chunks.filter(c => c.docId !== docId);

  const rawChunks = _chunkText(text);
  const newChunks = rawChunks.map((t, i) => ({
    id: `${docId}:${i}`, docId, filename, text: t,
  }));

  store.docs.push({
    id: docId, filename,
    size: text.length,
    chunks: rawChunks.length,
    addedAt: new Date().toISOString(),
  });
  store.chunks.push(...newChunks);
  store.idf = _buildIDF(store.chunks);

  _persist(orgId, store);
}

function removeDocument(orgId, docId) {
  if (!stores.has(orgId)) return;
  const store = stores.get(orgId);
  store.docs   = store.docs.filter(d => d.id !== docId);
  store.chunks = store.chunks.filter(c => c.docId !== docId);
  store.idf    = _buildIDF(store.chunks);
  _persist(orgId, store);
}

function listDocuments(orgId) {
  _loadIfNeeded(orgId);
  return stores.get(orgId)?.docs ?? [];
}

function search(orgId, query, topK = TOP_K) {
  _loadIfNeeded(orgId);
  const store = stores.get(orgId);
  if (!store || store.chunks.length === 0) return [];

  const qTerms = _tokenize(query);
  if (qTerms.length === 0) return [];

  const scored = store.chunks.map(chunk => ({
    ...chunk,
    score: _scoreTFIDF(qTerms, chunk.text, store.idf),
  }));

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function hasDocuments(orgId) {
  _loadIfNeeded(orgId);
  return (stores.get(orgId)?.chunks.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _ensureStore(orgId) {
  if (!stores.has(orgId)) {
    stores.set(orgId, { docs: [], chunks: [], idf: {} });
  }
}

function _loadIfNeeded(orgId) {
  if (stores.has(orgId)) return;
  _ensureStore(orgId);
  const file = _storeFile(orgId);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const store = stores.get(orgId);
    store.docs   = saved.docs   ?? [];
    store.chunks = saved.chunks ?? [];
    store.idf    = _buildIDF(store.chunks);
  } catch (_) { /* no saved data yet */ }
}

function _persist(orgId, store) {
  try {
    const dir = path.join(DATA_DIR, orgId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_storeFile(orgId), JSON.stringify({
      docs:   store.docs,
      chunks: store.chunks,
    }, null, 2));
  } catch (e) {
    console.error('[rag] Persist failed:', e.message);
  }
}

function _storeFile(orgId) {
  return path.join(DATA_DIR, orgId, 'rag.json');
}

function _chunkText(text) {
  // Normalise whitespace
  const clean = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
  const words = clean.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVL) {
    const slice = words.slice(i, i + CHUNK_SIZE).join(' ');
    if (slice.trim()) chunks.push(slice);
    if (i + CHUNK_SIZE >= words.length) break;
  }
  return chunks;
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall','this',
  'that','these','those','it','its','as','not','no','so','if','then','than',
  'when','where','which','who','how','all','any','some','we','you','they',
  'their','our','my','your','his','her','its','up','out','into','about','can',
  // Common Swahili stop words
  'na','ya','wa','la','za','kwa','katika','ni','si','au','lakini','hii','hiyo',
]);

function _tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function _buildIDF(chunks) {
  const docCount = chunks.length || 1;
  const termDocs = {};
  for (const chunk of chunks) {
    const terms = new Set(_tokenize(chunk.text));
    for (const t of terms) termDocs[t] = (termDocs[t] || 0) + 1;
  }
  const idf = {};
  for (const [term, count] of Object.entries(termDocs)) {
    idf[term] = Math.log((docCount + 1) / (count + 1)) + 1;
  }
  return idf;
}

function _scoreTFIDF(queryTerms, chunkText, idf) {
  const terms = _tokenize(chunkText);
  if (terms.length === 0) return 0;
  const tf = {};
  for (const t of terms) tf[t] = (tf[t] || 0) + 1;

  let score = 0;
  for (const qt of queryTerms) {
    if (tf[qt]) {
      const termFreq = tf[qt] / terms.length;
      const invDocFreq = idf[qt] || 1;
      score += termFreq * invDocFreq;
    }
  }
  return score;
}

module.exports = { addDocument, removeDocument, listDocuments, search, hasDocuments };
