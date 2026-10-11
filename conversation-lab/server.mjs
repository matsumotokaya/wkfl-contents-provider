import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from './lib/deps.mjs';
import { catalog, sampleText, validate } from './lib/catalog.mjs';
import { credentialSource, loadGoogleKey } from './lib/credentials.mjs';
import { synthesize, connectLive } from './lib/google.mjs';
import { pcmFromBase64 } from './lib/audio.mjs';
import { Store } from './lib/store.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export function createLab({ mock = false, dataDir = join(root, 'data', mock ? 'mock' : 'experiments'), maxSessionMs = 180000, provider = { synthesize, connectLive } } = {}) {
  const store = new Store(dataDir);
  const csrf = randomBytes(32).toString('hex');
  let port;
  let active = null;
  const allowedHost = host => host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  const trusted = req => allowedHost(req.headers.host) &&
    (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`) &&
    (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']));
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  async function readBody(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON required');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16000) throw new Error('Body too large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; media-src 'self' blob:; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    if (!trusted(req)) return json(res, 403, { error: 'Local same-origin access required' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-lab-token'] !== csrf)) return json(res, 403, { error: 'Invalid request token or Origin' });
    try {
      if (req.method === 'GET' && pathname === '/api/config') {
        let source = 'missing';
        try { source = mock ? 'mock-no-key-read' : credentialSource({ repoRoot: join(root, '..') }).type; } catch { source = 'invalid-path'; }
        return json(res, 200, { csrf, mock, catalog, sampleText, credentialSource: source, maxSeconds: Math.floor(maxSessionMs / 1000) });
      }
      if (req.method === 'GET' && pathname === '/api/experiments') return json(res, 200, store.list());
      if (req.method === 'POST' && pathname === '/api/stop') { active?.stop(); return json(res, 200, { stopped: true }); }
      if (req.method === 'POST' && pathname === '/api/tts') {
        const settings = validate('tts', await readBody(req));
        if (active) return json(res, 409, { error: 'Another experiment is running' });
        const controller = new AbortController();
        active = { stop: () => controller.abort() };
        const item = store.begin('tts', settings, mock);
        const begin = performance.now();
        const timeout = setTimeout(() => controller.abort(), 90000);
        const disconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', disconnect);
        try {
          const key = mock ? null : loadGoogleKey({ repoRoot: join(root, '..') });
          const result = await provider.synthesize(settings, { key, mock, signal: controller.signal });
          if (controller.signal.aborted) throw new Error('Aborted');
          store.audio(item, 'speech.wav', result.audio);
          if (result.usage) item.usage.push({ source: 'google-interactions', value: result.usage });
          item.metrics.push({ name: 'request_to_complete_wav_ms', value: Math.round(performance.now() - begin), simulated: mock });
          item.status = 'completed'; item.endedAt = new Date().toISOString(); store.save(item);
          return json(res, 200, item);
        } catch {
          item.status = controller.signal.aborted ? 'cancelled' : 'failed'; item.endedAt = new Date().toISOString(); store.save(item);
          return json(res, 502, { error: controller.signal.aborted ? 'Generation stopped or timed out; remote billing may already have occurred.' : 'Generation failed. Check key access, model availability and quota. No automatic retry.', id: item.id });
        } finally { clearTimeout(timeout); res.off('close', disconnect); active = null; }
      }
      const audio = pathname.match(/^\/experiments\/([a-f0-9-]{36})\/(speech\.wav|input\.wav|output\.wav|metadata\.json)$/);
      if (req.method === 'GET' && audio) {
        const path = join(dataDir, audio[1], audio[2]);
        if (!existsSync(path)) return json(res, 404, { error: 'File not found' });
        res.setHeader('Content-Type', audio[2].endsWith('.wav') ? 'audio/wav' : 'application/json');
        res.end(readFileSync(path)); return;
      }
      const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/audio-worklet.js': ['audio-worklet.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && files[pathname]) {
        res.setHeader('Content-Type', files[pathname][1]); res.end(readFileSync(join(root, 'public', files[pathname][0]))); return;
      }
      return json(res, 404, { error: 'Not found' });
    } catch { return json(res, 400, { error: 'Invalid request. Check model, voice, text and session limit.' }); }
  });
  server.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64000, handleProtocols: protocols => protocols.has('wkfl') ? 'wkfl' : false });
  server.on('upgrade', (req, socket, head) => {
    const protocols = (req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
    if (!trusted(req) || req.headers.origin !== `http://${req.headers.host}` || req.url !== '/live' || !protocols.includes(csrf) || !protocols.includes('wkfl') || active) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let item, upstream, ready = false, speaking = false, done = false, pendingEnd = null;
    let started = performance.now(), inputBytes = 0, outputBytes = 0;
    const input = [], output = [];
    let lastPong = performance.now();
    let limitTimer;
    const send = message => { if (ws.readyState === 1) ws.send(JSON.stringify(message)); };
    const finish = reason => {
      if (done) return;
      done = true; clearTimeout(initialTimer); clearTimeout(limitTimer); clearInterval(heartbeat);
      upstream?.close();
      try {
        if (item) { store.finishLive(item, input, output, reason); send({ type: 'saved', item }); }
      } catch { send({ type: 'error', message: 'Local recording could not be saved.' }); }
      if (active?.socket === ws) active = null;
      ws.close(1000, reason);
      const terminateTimer = setTimeout(() => ws.terminate(), 1000); terminateTimer.unref();
    };
    const initialTimer = setTimeout(() => finish('setup-timeout'), 20000);
    const heartbeat = setInterval(() => {
      if (performance.now() - lastPong > 25000) return finish('client-unavailable');
      ws.ping();
    }, 10000);
    active = { socket: ws, stop: () => finish('stopped') };
    ws.on('pong', () => { lastPong = performance.now(); });
    ws.on('message', data => {
      if (done) return;
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'stop') return finish('stopped');
        if (message.type === 'start' && !item) {
          const settings = validate('live', message);
          item = store.begin('live', settings, mock); started = performance.now();
          const key = mock ? null : loadGoogleKey({ repoRoot: join(root, '..') });
          limitTimer = setTimeout(() => finish('time-limit'), Math.min(settings.seconds * 1000, maxSessionMs));
          upstream = provider.connectLive(settings, {
            ready() { if (done) return; ready = true; speaking = settings.mode === 'automatic'; clearTimeout(initialTimer); send({ type: 'ready', id: item.id, seconds: settings.seconds, mock }); },
            error() { send({ type: 'error', message: 'Live connection failed. Check key access, model availability and quota. No automatic retry.' }); finish('provider-error'); },
            close() { finish('provider-closed'); },
            message(response) {
              if (done) return;
              try {
                const t = Math.round(performance.now() - started);
                if (response.usageMetadata) item.usage.push({ atMs: t, source: 'google-live', value: response.usageMetadata });
                const content = response.serverContent;
                if (!content) return;
                if (content.interrupted) send({ type: 'interrupted' });
                for (const part of content.modelTurn?.parts || []) {
                  const audio = part.inlineData;
                  if (!audio) continue;
                  if (!/^audio\/pcm(?:;rate=24000)?$/.test(audio.mimeType)) throw new Error('Unexpected audio format');
                  // Provider chunks can be larger than browser input frames.
                  const pcm = Buffer.from(audio.data, 'base64');
                  if (pcm.length % 2 || outputBytes + pcm.length > 12 * 1024 * 1024) throw new Error('Output size limit');
                  if (pendingEnd !== null) {
                    const metric = { name: 'server_activity_end_to_first_audio_ms', value: Math.round(performance.now() - pendingEnd), simulated: mock };
                    item.metrics.push(metric); send({ type: 'metric', metric }); pendingEnd = null;
                  }
                  item.events.push({ type: 'output-chunk', atMs: t, byteOffset: outputBytes, bytes: pcm.length });
                  output.push(pcm); outputBytes += pcm.length;
                  if (ws.bufferedAmount > 1024 * 1024) throw new Error('Slow client');
                  send({ type: 'audio', data: pcm.toString('base64') });
                }
                for (const [field, role] of [['inputTranscription', 'user'], ['outputTranscription', 'model']]) {
                  if (content[field]?.text) { const entry = { type: 'transcript', atMs: t, role, text: content[field].text }; item.events.push(entry); send(entry); }
                }
                if (content.turnComplete) send({ type: 'turnComplete' });
              } catch { finish('invalid-provider-data'); }
            },
          }, { key, mock });
          return;
        }
        if (!ready || !item) throw new Error('Session not ready');
        const atMs = Math.round(performance.now() - started);
        if (message.type === 'mockTurn' && mock) { upstream.send({ realtimeInput: { activityEnd: {} } }); return; }
        if (message.type === 'activityStart' && item.mode === 'manual' && !speaking) {
          speaking = true; pendingEnd = null;
          item.events.push({ type: 'activityStart', atMs });
          upstream.send({ realtimeInput: { activityStart: {} } }); return;
        }
        if (message.type === 'audio' && speaking) {
          const pcm = pcmFromBase64(message.data);
          if (inputBytes + pcm.length > 6 * 1024 * 1024) throw new Error('Input size limit');
          input.push(pcm); item.events.push({ type: 'input-chunk', atMs, byteOffset: inputBytes, bytes: pcm.length }); inputBytes += pcm.length;
          upstream.send({ realtimeInput: { audio: { data: message.data, mimeType: 'audio/pcm;rate=16000' } } }); return;
        }
        if (message.type === 'activityEnd' && item.mode === 'manual' && speaking) {
          speaking = false; pendingEnd = performance.now(); item.events.push({ type: 'activityEnd', atMs });
          upstream.send({ realtimeInput: { activityEnd: {} } }); return;
        }
        throw new Error('Invalid Live event');
      } catch { send({ type: 'error', message: 'Could not start or continue this experiment. Check settings and credential configuration.' }); finish('invalid-request'); }
    });
    ws.on('close', () => finish('client-closed'));
    ws.on('error', () => finish('client-error'));
  });
  return {
    server, store,
    async listen(requestedPort = 8788) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(requestedPort, '127.0.0.1', resolve); });
      port = server.address().port; return `http://127.0.0.1:${port}`;
    },
    async close() { active?.stop(); for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(resolve => server.close(resolve)); },
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mock = process.argv.includes('--mock');
  const lab = createLab({ mock });
  const url = await lab.listen(Number(process.env.CONVERSATION_LAB_PORT || 8788));
  console.log(`WKFL Conversation Lab: ${url} (${mock ? 'MOCK — synthetic test tone, no API/key access' : 'LIVE API mode — calls only after explicit action'})`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await lab.close(); process.exit(0); });
}
