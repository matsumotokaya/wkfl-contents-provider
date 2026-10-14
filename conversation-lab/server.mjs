import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from './lib/deps.mjs';
import { catalog, sampleText, validate, voiceProfiles, openaiVoiceProfiles, gptLiveVoiceProfiles, minimaxVoiceProfiles } from './lib/catalog.mjs';
import { credentialSource, loadGoogleKey, openaiCredentialSource, loadOpenAIKey, minimaxCredentialSource, loadMinimaxKey } from './lib/credentials.mjs';
import { synthesize, connectLive, liveGreetingPrompt } from './lib/google.mjs';
import { synthesize as synthesizeMinimax } from './lib/minimax.mjs';
import { connectRealtime } from './lib/openai.mjs';
import { connectGptLive } from './lib/openai-live.mjs';
import { pcmFromBase64 } from './lib/audio.mjs';
import { Timeline } from './lib/timeline.mjs';
import { Store } from './lib/store.mjs';
import { summarizeLive, summarizeTts } from './lib/cost.mjs';
import { TranscriptGrouper } from './lib/transcript.mjs';
import { studioCues } from './lib/studio.mjs';
import { demoSettings, demoSets, publicDemoSettings, readDemos } from './lib/voice-demos.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export function createLab({ mock = false, dataDir = join(root, 'data', mock ? 'mock' : 'experiments'), voiceDemoDir = join(root, 'data', 'voice-demos', demoSets.google.dirName), openaiVoiceDemoDir = join(root, 'data', 'voice-demos', demoSets.openai.dirName), historyLimit = 5, trashDir = null, maxSessionMs = 90 * 60 * 1000, provider = { synthesize, synthesizeMinimax, connectLive, connectRealtime, connectGptLive } } = {}) {
  const store = new Store(dataDir);
  store.recoverStale();
  // History is kept short on purpose (user decision, 2026-10-11); older items go to the trash folder.
  const prune = () => { try { store.prune(historyLimit, trashDir); } catch { /* Retention must never break a session. */ } };
  prune();
  const csrf = randomBytes(32).toString('hex');
  let port;
  let active = null;
  const allowedHost = host => host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  // A top-level page view may arrive from another site (e.g. browser automation). It cannot read responses
  // cross-origin, and paid calls still require the same-origin Origin plus the in-memory token (POST / WebSocket).
  const navigation = req => req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
  const trusted = req => allowedHost(req.headers.host) &&
    (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`) &&
    (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']) || navigation(req));
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
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; media-src 'self' blob: https://docs.cloud.google.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    if (!trusted(req)) return json(res, 403, { error: 'Local same-origin access required' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-lab-token'] !== csrf)) return json(res, 403, { error: 'Invalid request token or Origin' });
    try {
      if (req.method === 'GET' && pathname === '/health') return json(res, 200, { status: 'ok', mock, providerCallsOnPageLoad: false });
      if (req.method === 'GET' && pathname === '/api/config') {
        let source = 'missing', openaiSource = 'missing', minimaxSource = 'missing';
        try { source = mock ? 'mock-no-key-read' : credentialSource({ repoRoot: join(root, '..') }).type; } catch { source = 'invalid-path'; }
        try { openaiSource = mock ? 'mock-no-key-read' : openaiCredentialSource().type; } catch { openaiSource = 'invalid-path'; }
        try { minimaxSource = mock ? 'mock-no-key-read' : minimaxCredentialSource().type; } catch { minimaxSource = 'invalid-path'; }
        return json(res, 200, { csrf, mock, catalog, voiceProfiles, openaiVoiceProfiles, gptLiveVoiceProfiles, minimaxVoiceProfiles, openaiCredentialSource: openaiSource, minimaxCredentialSource: minimaxSource, voiceDemos: { ...demoSettings, demos: readDemos(voiceDemoDir) }, openaiVoiceDemos: { ...publicDemoSettings(demoSets.openai), demos: readDemos(openaiVoiceDemoDir, demoSets.openai) }, sampleText, credentialSource: source, maxSeconds: Math.floor(maxSessionMs / 1000) });
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
          const minimax = settings.provider === 'minimax';
          const key = mock ? null : minimax ? loadMinimaxKey() : loadGoogleKey({ repoRoot: join(root, '..') });
          const result = await (minimax ? provider.synthesizeMinimax : provider.synthesize)(settings, { key, mock, signal: controller.signal });
          if (controller.signal.aborted) throw new Error('Aborted');
          store.audio(item, 'speech.wav', result.audio);
          if (result.usage) item.usage.push({ source: minimax ? 'minimax-t2a' : 'google-interactions', value: result.usage });
          item.costSummary = summarizeTts(item);
          item.metrics.push({ name: 'request_to_complete_wav_ms', value: Math.round(performance.now() - begin), simulated: mock });
          item.status = 'completed'; item.endedAt = new Date().toISOString(); store.save(item); prune();
          return json(res, 200, item);
        } catch (error) {
          // Our own messages only (HTTP status, provider status code, quota id); provider bodies never reach them.
          item.status = controller.signal.aborted ? 'cancelled' : 'failed'; item.endedAt = new Date().toISOString();
          if (!controller.signal.aborted) item.error = String(error?.message || '').slice(0, 200);
          store.save(item);
          return json(res, 502, { error: controller.signal.aborted ? 'Generation stopped or timed out; remote billing may already have occurred.' : 'Generation failed. Check key access, model availability and quota. No automatic retry.', id: item.id });
        } finally { clearTimeout(timeout); res.off('close', disconnect); active = null; }
      }
      const audio = pathname.match(/^\/experiments\/([a-f0-9-]{36})\/(speech\.wav|input\.wav|output\.wav|mix\.wav|input-source\.wav|generated\.wav|metadata\.json)$/);
      if (req.method === 'GET' && audio) {
        const path = join(dataDir, audio[1], audio[2]);
        if (!existsSync(path)) return json(res, 404, { error: 'File not found' });
        res.setHeader('Content-Type', audio[2].endsWith('.wav') ? 'audio/wav' : 'application/json');
        res.end(readFileSync(path)); return;
      }
      const demo = pathname.match(/^\/voice-demos\/(ja|openai-ja)\/([A-Za-z]+)\.wav$/);
      const demoSet = demo && (demo[1] === 'ja' ? demoSets.google : demoSets.openai);
      if (req.method === 'GET' && demo && demoSet.voices.includes(demo[2])) {
        const path = join(demo[1] === 'ja' ? voiceDemoDir : openaiVoiceDemoDir, `${demo[2]}.wav`);
        if (!existsSync(path)) return json(res, 404, { error: 'File not found' });
        res.setHeader('Content-Type', 'audio/wav'); res.end(readFileSync(path)); return;
      }
      if (req.method === 'GET' && pathname === '/cost.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(readFileSync(join(root, 'lib/cost.mjs'))); return; }
      if (req.method === 'GET' && pathname === '/studio.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(readFileSync(join(root, 'lib/studio.mjs'))); return; }
      if (req.method === 'GET' && pathname === '/transcript.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(readFileSync(join(root, 'lib/transcript.mjs'))); return; }
      if (req.method === 'GET' && pathname === '/snippets.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(readFileSync(join(root, 'lib/snippets.mjs'))); return; }
      const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/studio': ['studio.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/studio.js': ['studio.js', 'text/javascript'], '/live-session.js': ['live-session.js', 'text/javascript'], '/shared.js': ['shared.js', 'text/javascript'], '/audio-worklet.js': ['audio-worklet.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
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
    let started = performance.now(), lastPong = performance.now();
    let limitTimer, drainTimer, draining = false, drainReason;
    // Conversation first. Recording, logging and usage tracking are aids: none of them ends a
    // session. Audio chunks are counted, not logged; transcripts are stored per speaker run;
    // noisy event types are capped so a 90-minute record stays small.
    const transport = { inputBytes: 0, inputChunks: 0, outputBytes: 0, outputChunks: 0, droppedInputChunks: 0 };
    const counts = {};
    const now = () => Math.round(performance.now() - started);
    const log = (event, cap = 200) => {
      counts[event.type] = (counts[event.type] || 0) + 1;
      if (counts[event.type] <= cap) item.events.push(event);
      else if (counts[event.type] === cap + 1) item.events.push({ type: 'log-capped', of: event.type, cap, atMs: now() });
    };
    // Fragments are grouped into speaker lines here (lib/transcript.mjs); stored events are those
    // lines and the browser only renders them. Times: the provider's speech times when sent
    // (GPT-Live), the speech start for Realtime's late user transcript, else arrival.
    const grouper = new TranscriptGrouper();
    const transcript = (role, part) => {
      const t = now();
      const startMs = Number.isFinite(part.startMs) ? part.startMs : Number.isFinite(part.spokenAt) ? Math.round(part.spokenAt - started) : t;
      const endMs = Number.isFinite(part.endMs) ? part.endMs : t;
      const { line, created } = grouper.add(role, part.text, startMs, endMs);
      if (created) item.events.push(Object.assign(line, { type: 'transcript' }));
      send({ type: 'transcript', index: line.index, role, text: part.text, atMs: line.atMs, untilMs: line.untilMs });
    };
    // Audio streams to disk as it arrives; the bound only sizes the longest allowed session plus the drain grace.
    const timeline = new Timeline((Math.ceil(maxSessionMs / 1000) + 2) * 16000);
    const send = message => { if (ws.readyState === 1) ws.send(JSON.stringify(message)); };
    const finish = reason => {
      if (done) return;
      done = true; clearTimeout(initialTimer); clearTimeout(limitTimer); clearTimeout(drainTimer); clearInterval(heartbeat);
      upstream?.close(); pending?.upstream?.close(); pending = null;
      try {
        if (item) { store.finishLive(item, reason, timeline); send({ type: 'saved', item }); }
        prune();
      } catch { send({ type: 'error', message: 'Local recording could not be saved.' }); }
      if (active?.socket === ws) active = null;
      ws.close(1000, reason);
      const terminateTimer = setTimeout(() => ws.terminate(), 1000); terminateTimer.unref();
    };
    const requestFinish = reason => {
      if (done || draining) return;
      draining = true; drainReason = reason; upstream?.close(); pending?.upstream?.close(); pending = null;
      clearTimeout(limitTimer);
      // The paid connection ends immediately. Only local recording flush is
      // allowed during this bounded grace period.
      if (!ready || timeline.complete || ws.readyState !== 1) return finish(reason);
      send({ type: 'drain', reason });
      drainTimer = setTimeout(() => finish(reason), 1200);
    };
    const initialTimer = setTimeout(() => finish('setup-timeout'), 20000);
    const heartbeat = setInterval(() => {
      if (performance.now() - lastPong > 25000) return finish('client-unavailable');
      ws.ping();
    }, 10000);
    active = { socket: ws, stop: () => requestFinish('stopped') };
    const recordingMessages = new Set(['recordingStarted', 'recordingChunk', 'recordingEnd', 'recordingDrift']);
    const integer = value => (Number.isSafeInteger(value) ? value : null);
    const recording = message => {
      const atMs = now();
      try {
        if (message.type === 'recordingStarted') { timeline.start(message.frameOrigin, store.dir(item)); item.events.push({ type: 'recording-start', serverAtMs: atMs, frameOrigin: message.frameOrigin }); }
        else if (message.type === 'recordingChunk') { const anomaly = timeline.append(message); if (anomaly) log({ type: 'recording-anomaly', atMs, reason: anomaly.type, startFrame: anomaly.startFrame, frames: anomaly.frames, endFrame: anomaly.endFrame }, 40); }
        else if (message.type === 'recordingEnd') { timeline.end(message.frames); if (draining) finish(drainReason); }
        else log({ type: 'recording-drift', atMs, frames: integer(message.frames), currentFrame: integer(message.currentFrame), origin: integer(message.origin), drift: integer(message.drift) }, 40);
      } catch (error) {
        log({ type: 'recording-error', atMs, messageType: message.type, error: String(error?.message).slice(0, 200), startFrame: integer(message.startFrame), frames: integer(message.frames), endFrame: timeline.endFrame }, 40);
        if (message.type === 'recordingEnd' && draining) finish(drainReason);
      }
    };
    // Provider connection. A Gemini session continues across connections (official session
    // resumption): the latest resumable handle is kept, and on GoAway or an unexpected close a
    // replacement connection is opened with it while the conversation goes on. Audio that
    // arrives while no connection is open is dropped and counted, never fatal.
    let settings, key, connect, generation = 0, current = 0, pending = null, resumeHandle = null, reconnects = 0;
    const maxReconnects = 12;
    const reconnect = reason => {
      if (done || draining || pending || settings.provider !== 'google' || !resumeHandle || reconnects >= maxReconnects) return false;
      reconnects++;
      log({ type: 'provider-reconnect', atMs: now(), reason, attempt: reconnects }, 40);
      pending = { generation: generation + 1, upstream: null };
      try { pending.upstream = open({ ...settings, resumeHandle }); }
      catch (error) { pending = null; log({ type: 'provider-reconnect-failed', atMs: now(), detail: String(error?.message).slice(0, 200) }, 40); return false; }
      return true;
    };
    const content = response => {
      try {
        const t = now();
        if (response.usageMetadata) item.usage.push({ atMs: t, source: 'google-live', value: response.usageMetadata });
        if (response.providerEvent) log({ type: 'provider-event', atMs: t, ...response.providerEvent });
        const other = Object.keys(response).filter(k => !['serverContent', 'usageMetadata', 'setupComplete', 'providerUsage', 'providerEvent', 'sessionResumptionUpdate'].includes(k));
        if (other.length) log({ type: 'provider-message', atMs: t, keys: other.slice(0, 10) });
        if (response.goAway) { log({ type: 'provider-goaway', atMs: t, timeLeft: typeof response.goAway.timeLeft === 'string' ? response.goAway.timeLeft.slice(0, 20) : null }, 40); reconnect('goAway'); }
        const c = response.serverContent;
        if (!c) return;
        if (c.interrupted) { log({ type: 'provider-interrupted', atMs: t }); send({ type: 'interrupted' }); }
        for (const part of c.modelTurn?.parts || []) {
          const audio = part.inlineData;
          if (!audio) continue;
          if (!/^audio\/pcm(?:;rate=24000)?$/.test(audio.mimeType)) { log({ type: 'provider-data-error', atMs: t, error: 'Unexpected audio format' }, 20); continue; }
          const pcm = Buffer.from(audio.data, 'base64');
          if (!pcm.length || pcm.length % 2) { log({ type: 'provider-data-error', atMs: t, error: 'Odd PCM length' }, 20); continue; }
          if (pendingEnd !== null) {
            const metric = { name: 'server_activity_end_to_first_audio_ms', value: Math.round(performance.now() - pendingEnd), simulated: mock };
            item.metrics.push(metric); send({ type: 'metric', metric }); pendingEnd = null;
          }
          transport.outputBytes += pcm.length; transport.outputChunks++;
          // A browser that stops reading loses audio; the conversation itself is not ended for it.
          if (ws.bufferedAmount > 4 * 1024 * 1024) { log({ type: 'browser-backlog', atMs: t }, 5); continue; }
          send({ type: 'audio', data: pcm.toString('base64') });
        }
        for (const [field, role] of [['inputTranscription', 'user'], ['outputTranscription', 'model']]) if (c[field]?.text) transcript(role, c[field]);
        if (c.turnComplete) { grouper.close('model'); send({ type: 'turnComplete' }); }
      } catch (error) { log({ type: 'provider-data-error', atMs: now(), error: String(error?.message).slice(0, 200) }, 20); }
    };
    const open = (connectSettings, initial = false) => {
      const mine = ++generation;
      if (initial) current = mine;
      const isCurrent = () => mine === current, isPending = () => pending?.generation === mine;
      return connect(connectSettings, {
        ready() {
          if (done) return;
          if (isPending()) {
            const old = upstream; upstream = pending.upstream; current = mine; pending = null; old?.close();
            log({ type: 'provider-resumed', atMs: now() }, 40); return;
          }
          if (!isCurrent()) return;
          ready = true; speaking = settings.mode === 'automatic'; clearTimeout(initialTimer); send({ type: 'ready', id: item.id, seconds: settings.seconds, mock });
          if (mock) return;
          // The studio sends its own opening cue (e.g. start the show); the model lab uses the greeting.
          try { upstream.send({ realtimeInput: { text: settings.opening || liveGreetingPrompt } }); item.events.push({ type: 'greeting-requested', atMs: now() }); }
          catch (error) { item.events.push({ type: 'server-error', atMs: now(), stage: 'greeting', error: String(error?.message).slice(0, 200) }); requestFinish('provider-unavailable'); }
        },
        error(info = {}) {
          if (done) return;
          if (isPending()) { pending = null; log({ type: 'provider-reconnect-failed', atMs: now(), detail: info.detail ?? null }, 40); if (!upstream) requestFinish('provider-closed'); return; }
          if (!isCurrent()) return;
          log({ type: 'provider-error', atMs: now(), detail: info.detail ?? null }, 40);
          if (reconnect('error')) { upstream = null; return; }
          send({ type: 'error', message: 'Live connection failed. Check key access, model availability and quota. No automatic retry.' }); requestFinish('provider-error');
        },
        close(info = {}) {
          if (done) return;
          if (isPending()) { pending = null; log({ type: 'provider-reconnect-failed', atMs: now(), code: info.code ?? null, reason: info.reason ?? null }, 40); if (!upstream) requestFinish('provider-closed'); return; }
          if (!isCurrent()) return;
          log({ type: 'provider-close', atMs: now(), code: info.code ?? null, reason: info.reason ?? null }, 40);
          if (pending || reconnect('close')) { upstream = null; return; }
          requestFinish('provider-closed');
        },
        message(response) {
          // Final usage can arrive after the session was saved (GPT-Live's session.closed): update the saved record.
          if (done) {
            if (response.providerUsage && item) {
              item.usage.push({ atMs: now(), source: response.providerUsage.source, value: response.providerUsage.value, afterSave: true });
              try { item.costSummary = summarizeLive(item); store.save(item); } catch { /* The record may have moved to the trash. */ }
            }
            return;
          }
          if (response.sessionResumptionUpdate?.resumable && typeof response.sessionResumptionUpdate.newHandle === 'string' && response.sessionResumptionUpdate.newHandle) resumeHandle = response.sessionResumptionUpdate.newHandle.slice(0, 4096);
          if (!isCurrent()) return;
          // Usage still counts while draining (e.g. GPT-Live's final seconds arrive after session.close).
          if (response.providerUsage) item.usage.push({ atMs: now(), source: response.providerUsage.source, value: response.providerUsage.value });
          if (draining) return;
          content(response);
        },
      }, { key, mock });
    };
    ws.on('pong', () => { lastPong = performance.now(); });
    ws.on('message', data => {
      if (done) return;
      let message;
      try {
        message = JSON.parse(data.toString());
        if (message.type === 'stop') return requestFinish('stopped');
        if (item && ready && recordingMessages.has(message.type)) { recording(message); return; }
        if (draining) return;
        if (message.type === 'start' && !item) {
          settings = validate('live', message);
          item = store.begin('live', settings, mock); item.transport = transport; item.transcriptFormat = 'speaker-lines-v1'; started = performance.now();
          const openai = settings.provider === 'openai' || settings.provider === 'openai-live';
          key = mock ? null : openai ? loadOpenAIKey() : loadGoogleKey({ repoRoot: join(root, '..') });
          limitTimer = setTimeout(() => requestFinish('time-limit'), Math.min(settings.seconds * 1000, maxSessionMs));
          // Mock mode always uses the synthetic tone path, whatever the provider.
          connect = mock ? provider.connectLive : settings.provider === 'openai-live' ? provider.connectGptLive : openai ? provider.connectRealtime : provider.connectLive;
          upstream = open(settings, true);
          return;
        }
        // Director cues from the studio. Forwarded as an instruction; a failure is logged, never fatal.
        if (message.type === 'cue' && ready && item) {
          const entry = { type: 'cue', atMs: now(), cue: typeof message.cue === 'string' ? message.cue.slice(0, 40) : null }, text = studioCues[message.cue];
          if (!text) { log({ ...entry, error: 'Unknown cue' }, 20); return; }
          try { upstream?.send({ instruction: text }); log(entry, 20); } catch (error) { log({ ...entry, error: String(error?.message).slice(0, 200) }, 20); }
          return;
        }
        if (!ready || !item) throw new Error('Session not ready');
        const atMs = now();
        if (message.type === 'mockTurn' && mock) { upstream?.send({ realtimeInput: { activityEnd: {} } }); return; }
        if (message.type === 'activityStart' && item.mode === 'manual' && !speaking) {
          speaking = true; pendingEnd = null;
          item.events.push({ type: 'activityStart', atMs });
          upstream?.send({ realtimeInput: { activityStart: {} } }); return;
        }
        if (message.type === 'audio' && speaking) {
          const pcm = pcmFromBase64(message.data);
          transport.inputBytes += pcm.length; transport.inputChunks++;
          if (!upstream) { transport.droppedInputChunks++; return; }
          upstream.send({ realtimeInput: { audio: { data: message.data, mimeType: 'audio/pcm;rate=16000' } } }); return;
        }
        if (message.type === 'activityEnd' && item.mode === 'manual' && speaking) {
          speaking = false; pendingEnd = performance.now(); item.events.push({ type: 'activityEnd', atMs });
          upstream?.send({ realtimeInput: { activityEnd: {} } }); return;
        }
        throw new Error('Invalid Live event');
      } catch (error) {
        if (item) log({ type: 'server-error', atMs: now(), stage: 'client-message', messageType: typeof message?.type === 'string' ? message.type.slice(0, 40) : null, error: String(error?.message).slice(0, 200) }, 40);
        if (error?.upstream) {
          // The provider connection is gone, not the browser. Gemini goes on through a resumed connection.
          if (pending || reconnect('send-failed')) { upstream = null; return; }
          send({ type: 'error', message: 'AI側の接続が切れました。録音を保存します。' }); return requestFinish('provider-unavailable');
        }
        send({ type: 'error', message: 'Could not start or continue this experiment. Check settings and credential configuration.' }); finish('invalid-request');
      }
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
  // Only the real app moves old history to the macOS trash; tests and embedding callers keep everything.
  const lab = createLab({ mock, trashDir: join(homedir(), '.Trash') });
  const url = await lab.listen(Number(process.env.CONVERSATION_LAB_PORT || 8788));
  console.log(`WKFL Conversation Lab: ${url} (${mock ? 'MOCK — synthetic test tone, no API/key access' : 'LIVE API mode — calls only after explicit action'})`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await lab.close(); process.exit(0); });
}
