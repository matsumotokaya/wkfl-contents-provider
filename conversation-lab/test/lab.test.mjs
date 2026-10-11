import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import tls from 'node:tls';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createLab } from '../server.mjs';
import { WebSocket } from '../lib/deps.mjs';
import { synthesize, ttsRequest, liveSetup } from '../lib/google.mjs';
import { loadGoogleKey } from '../lib/credentials.mjs';

// Fail closed: no real HTTPS/WSS or fetch calls are allowed anywhere in this suite.
globalThis.fetch = () => { throw new Error('External fetch forbidden in tests'); };
tls.connect = () => { throw new Error('TLS forbidden in tests'); };
const settings = { model: 'gemini-3.8-flash-tts', voice: 'Kore', text: 'テスト', condition: 'calm' };
function request(url, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url + path, { method, headers }, res => {
      const chunks = []; res.on('data', data => chunks.push(data));
      res.on('end', () => { const buffer = Buffer.concat(chunks); let value; try { value = JSON.parse(buffer); } catch { value = buffer; } resolve({ status: res.statusCode, value, headers: res.headers }); });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-lab-test-'));
  const lab = createLab({ mock: true, dataDir: dir, ...options });
  const url = await lab.listen(0);
  t.after(async () => { await lab.close(); rmSync(dir, { recursive: true, force: true }); });
  const config = (await request(url, '/api/config')).value;
  const headers = { Origin: url, 'X-Lab-Token': config.csrf, 'Content-Type': 'application/json' };
  return { lab, dir, url, config, headers };
}
function live(url, token) {
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/live', ['wkfl', token], { origin: url });
  const messages = [], waits = [];
  ws.on('message', data => { const value = JSON.parse(data.toString()); messages.push(value); for (const notify of waits) notify(); });
  const next = type => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Missing ${type}`)), 3000);
    const check = () => { const index = messages.findIndex(m => m.type === type); if (index >= 0) { clearTimeout(timer); waits.splice(waits.indexOf(check), 1); resolve(messages.splice(index, 1)[0]); } };
    waits.push(check); check();
  });
  return { ws, next };
}
const start = { type: 'start', model: 'gemini-3.8-live', voice: 'Kore', condition: 'test', seconds: 15, mode: 'manual' };

test('Host, Origin, CSRF and cross-site GET are rejected before generation', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.url, '/api/config', { headers: { Host: 'evil.test' } })).status, 403);
  assert.equal((await request(f.url, '/api/config', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const navigate = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  assert.equal((await request(f.url, '/', { headers: navigate })).status, 200);
  assert.equal((await request(f.url, '/api/config', { headers: { ...navigate, 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' } })).status, 403);
  assert.equal((await request(f.url, '/api/tts', { method: 'POST', headers: { ...f.headers, ...navigate, Origin: 'https://evil.test' }, body: settings })).status, 403);
  assert.equal((await request(f.url, '/api/tts', { method: 'POST', headers: { ...f.headers, Origin: 'https://evil.test' }, body: settings })).status, 403);
  assert.equal((await request(f.url, '/api/tts', { method: 'POST', headers: { ...f.headers, 'X-Lab-Token': 'wrong' }, body: settings })).status, 403);
  assert.deepEqual(f.lab.store.list(), []);
});
test('one mock TTS saves WAV and honest metadata without credentials or network', async t => {
  const f = await fixture(t);
  const result = await request(f.url, '/api/tts', { method: 'POST', headers: f.headers, body: settings });
  assert.equal(result.status, 200); assert.equal(result.value.mock, true); assert.equal(result.value.cost, null);
  assert.deepEqual(result.value.usage, []); assert.equal(result.value.metrics[0].simulated, true);
  const audio = await request(f.url, `/experiments/${result.value.id}/speech.wav`);
  assert.equal(audio.value.subarray(0, 4).toString(), 'RIFF');
  assert.equal(f.config.credentialSource, 'mock-no-key-read');
  assert.equal((await request(f.url, '/api/tts', { method: 'POST', headers: f.headers, body: { ...settings, model: 'gemini-3.8-flash' } })).status, 400);
});
test('manual mock dialog saves separate tracks, usage stays unknown, measured timing marked simulated', async t => {
  const f = await fixture(t); const { ws, next } = live(f.url, f.config.csrf); await once(ws, 'open');
  ws.send(JSON.stringify(start)); await next('ready');
  ws.send(JSON.stringify({ type: 'activityStart' }));
  ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(3200).toString('base64') }));
  ws.send(JSON.stringify({ type: 'activityEnd' }));
  assert.equal((await next('metric')).metric.simulated, true); await next('audio');
  ws.send(JSON.stringify({ type: 'stop' })); const { item } = await next('saved');
  assert.equal(item.status, 'completed'); assert.deepEqual(item.files, ['input-source.wav', 'generated.wav']);
  assert.equal(item.recording.unavailable, true);
  assert.equal(item.events.filter(e => e.type === 'input-chunk')[0].bytes, 3200);
  assert.equal(readFileSync(join(f.dir, item.id, 'input-source.wav')).readUInt32LE(24), 16000);
  assert.equal(readFileSync(join(f.dir, item.id, 'generated.wav')).readUInt32LE(24), 24000);
  ws.terminate();
});
test('automatic mode accepts continuous input and stops at the server time limit', async t => {
  const f = await fixture(t, { maxSessionMs: 150 }); const { ws, next } = live(f.url, f.config.csrf); await once(ws, 'open');
  ws.send(JSON.stringify({ ...start, mode: 'automatic' })); await next('ready');
  ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(3200).toString('base64') }));
  ws.send(JSON.stringify({ type: 'mockTurn' })); await next('audio');
  const { item } = await next('saved'); assert.equal(item.endReason, 'time-limit'); assert.equal(item.metrics.length, 0); ws.terminate();
});
test('a closed provider connection is recorded and not blamed on the browser', async t => {
  const provider = { synthesize, connectLive: (_settings, callbacks) => { setTimeout(() => callbacks.ready(), 5); return { send(message) { if (message.realtimeInput?.audio) throw Object.assign(new Error('Live connection not open (state 2)'), { upstream: true }); }, close() {} }; } };
  const f = await fixture(t, { provider }); const { ws, next } = live(f.url, f.config.csrf); await once(ws, 'open');
  ws.send(JSON.stringify({ ...start, mode: 'automatic' })); await next('ready');
  ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(3200).toString('base64') }));
  const { item } = await next('saved');
  assert.equal(item.endReason, 'provider-unavailable');
  const error = item.events.find(e => e.type === 'server-error');
  assert.equal(error.messageType, 'audio'); assert.match(error.error, /not open/);
  ws.terminate();
});
test('provider close code and reason are kept for diagnosis', async t => {
  let callbacks;
  const provider = { synthesize, connectLive: (_settings, cb) => { callbacks = cb; setTimeout(() => cb.ready(), 5); return { send() {}, close() {} }; } };
  const f = await fixture(t, { provider }); const { ws, next } = live(f.url, f.config.csrf); await once(ws, 'open');
  ws.send(JSON.stringify({ ...start, mode: 'automatic' })); await next('ready');
  callbacks.close({ code: 1011, reason: 'Internal error' });
  const { item } = await next('saved');
  assert.equal(item.endReason, 'provider-closed');
  const closeEvent = item.events.find(e => e.type === 'provider-close');
  assert.equal(closeEvent.code, 1011); assert.equal(closeEvent.reason, 'Internal error');
  ws.terminate();
});
test('usage that arrives after the session was saved updates the saved record', async t => {
  let callbacks;
  const provider = { synthesize, connectLive: (_settings, cb) => { callbacks = cb; setTimeout(() => cb.ready(), 5); return { send() {}, close() {} }; } };
  const f = await fixture(t, { provider }); const { ws, next } = live(f.url, f.config.csrf); await once(ws, 'open');
  ws.send(JSON.stringify({ ...start, mode: 'automatic' })); const ready = await next('ready');
  ws.send(JSON.stringify({ type: 'stop' })); await next('saved');
  callbacks.message({ providerUsage: { source: 'openai-live-voice', value: { seconds: 7, final: true } } });
  callbacks.message({ serverContent: { outputTranscription: { text: 'ignored after save' } } });
  const saved = JSON.parse(readFileSync(join(f.dir, ready.id, 'metadata.json'), 'utf8'));
  assert.equal(saved.usage.length, 1); assert.deepEqual(saved.usage[0].value, { seconds: 7, final: true }); assert.equal(saved.usage[0].afterSave, true);
  assert.equal(saved.events.filter(e => e.type === 'transcript').length, 0);
  ws.terminate();
});
test('WebSocket rejects cross-origin and wrong token handshakes', async t => {
  const f = await fixture(t);
  for (const [origin, token] of [['https://evil.test', f.config.csrf], [f.url, 'wrong']]) {
    const ws = new WebSocket(f.url.replace('http:', 'ws:') + '/live', ['wkfl', token], { origin });
    const error = await new Promise(resolve => ws.once('error', resolve)); assert.match(error.message, /403/); ws.terminate();
  }
  assert.equal(f.lab.store.list().length, 0);
});
test('one active session blocks duplicate generation; disconnect saves partial session', async t => {
  const f = await fixture(t); const { ws, next } = live(f.url, f.config.csrf); await once(ws, 'open');
  ws.send(JSON.stringify(start)); const ready = await next('ready');
  assert.equal((await request(f.url, '/api/tts', { method: 'POST', headers: f.headers, body: settings })).status, 409);
  const saved = new Promise(resolve => { const original = f.lab.store.save.bind(f.lab.store); f.lab.store.save = item => { original(item); if (item.id === ready.id && item.status === 'interrupted') resolve(); }; });
  ws.close(); await once(ws, 'close'); await saved;
  const item = f.lab.store.list().find(item => item.id === ready.id); assert.equal(item.status, 'interrupted');
});
test('TTS stop aborts in-flight work and preserves a cancelled record', async t => {
  let entered; const running = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { provider: { synthesize: async (_s, { signal }) => { entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })); } } });
  const pending = request(f.url, '/api/tts', { method: 'POST', headers: f.headers, body: settings });
  await running; await request(f.url, '/api/stop', { method: 'POST', headers: f.headers, body: {} });
  assert.equal((await pending).status, 502); assert.equal(f.lab.store.list()[0].status, 'cancelled');
});
test('provider REST payload separates style and transcript; audio comes from REST steps', async () => {
  const requestBody = ttsRequest(settings); assert.equal(requestBody.input[0].content[0].text, 'テスト');
  assert.equal(requestBody.input[0].content[0].annotations[0].style, 'calm'); assert.equal(requestBody.store, false);
  const mock = await synthesize(settings, { mock: true });
  const result = await synthesize(settings, { key: 'FAKE_TEST_VALUE', mock: false, fetcher: async () => ({ ok: true, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: mock.audio.toString('base64') }] }], usage: { total_tokens: 10 } }) }) });
  assert.equal(result.usage.total_tokens, 10); assert.deepEqual(result.audio, mock.audio);
});
test('Live VAD is automatic by default selection; manual is explicit', () => {
  assert.equal(liveSetup({ ...start, mode: 'automatic' }).setup.realtimeInputConfig.automaticActivityDetection.disabled, false);
  assert.equal(liveSetup(start).setup.realtimeInputConfig.automaticActivityDetection.disabled, true);
});
test('credential resolution reads only a selected fake key, without global injection', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-lab-credential-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'tts-studio')); mkdirSync(join(dir, '.secrets', 'wkfl'), { recursive: true });
  writeFileSync(join(dir, 'tts-studio', '.env'), 'UNRELATED_FAKE_KEY=do-not-inject\nGEMINI_API_KEY=fake-legacy\n');
  const env = {}; assert.equal(loadGoogleKey({ env, home: dir, repoRoot: dir }), 'fake-legacy'); assert.deepEqual(env, {});
  assert.equal(loadGoogleKey({ env: { GEMINI_API_KEY_FILE: '/must-not-read' }, home: '/missing', repoRoot: '/missing', mock: true }), undefined);
  writeFileSync(join(dir, '.secrets', 'gemini-token'), 'fake-unrelated-global');
  assert.equal(loadGoogleKey({ env, home: dir, repoRoot: dir }), 'fake-legacy');
  writeFileSync(join(dir, '.secrets', 'wkfl', 'gemini-token'), 'fake-home');
  assert.equal(loadGoogleKey({ env, home: dir, repoRoot: dir }), 'fake-home');
  assert.throws(() => loadGoogleKey({ env: { GEMINI_API_KEY_FILE: '/missing-explicit-file' }, home: dir, repoRoot: dir }));
});


test('health and recording drain are local only; server keeps received audio separate', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.url, '/health')).value.mock, true);
  assert.equal((await request(f.url, '/health', { headers: { Origin: 'https://external.test' } })).status, 403);
  const { ws, next } = live(f.url, f.config.csrf); await once(ws, 'open');
  ws.send(JSON.stringify({ ...start, mode: 'automatic' })); await next('ready');
  ws.send(JSON.stringify({ type: 'recordingStarted', frameOrigin: 16000 }));
  const silence = Buffer.alloc(3200), mic = Buffer.alloc(3200), played = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) { mic.writeInt16LE(2000, i * 2); played.writeInt16LE(4000, i * 2); }
  for (const [index, input, playback] of [[0, silence, silence], [1, mic, silence], [2, silence, played], [3, silence, silence]]) {
    ws.send(JSON.stringify({ type: 'recordingChunk', startFrame: index * 1600, input: input.toString('base64'), playback: playback.toString('base64') }));
  }
  ws.send(JSON.stringify({ type: 'mockTurn' })); await next('audio');
  ws.send(JSON.stringify({ type: 'stop' })); await next('drain');
  ws.send(JSON.stringify({ type: 'recordingEnd', frames: 6400 }));
  const { item } = await next('saved');
  assert.equal(item.recording.complete, true); assert.equal(item.recording.durationMs, 400);
  const output = readFileSync(join(f.dir, item.id, 'output.wav'));
  const input = readFileSync(join(f.dir, item.id, 'input.wav'));
  const mix = readFileSync(join(f.dir, item.id, 'mix.wav'));
  assert.equal(output.length, 44 + 6400 * 2); assert.equal(input.length, output.length);
  assert.equal(input.readInt16LE(44 + 1600 * 2), 2000);
  assert.equal(output.readInt16LE(44 + 3200 * 2), 4000);
  assert.equal(output.readInt16LE(44 + 4800 * 2), 0);
  assert.equal(mix.readInt16LE(44 + 3200 * 2), 2000);
  assert.ok(item.files.includes('generated.wav'));
  assert.equal((await request(f.url, `/experiments/${item.id}/mix.wav`)).status, 200);
  ws.terminate();
});
