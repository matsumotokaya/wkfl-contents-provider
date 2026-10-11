import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import tls from 'node:tls';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLab } from '../server.mjs';
import { wav, mockTone } from '../lib/audio.mjs';
import { quotaHint, redactProviderBody } from '../lib/google.mjs';
import { demoSettings, demoStatus, estimateDemoUsd, generateDemos, readDemos, wavSeconds } from '../lib/voice-demos.mjs';

globalThis.fetch = () => { throw new Error('External fetch forbidden in tests'); };
tls.connect = () => { throw new Error('TLS forbidden in tests'); };
const fakeAudio = wav(mockTone(), 24000);
function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'wkfl-demo-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function get(url, path) {
  return new Promise((resolve, reject) => http.get(url + path, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), type: res.headers['content-type'] })); }).on('error', reject));
}

test('upper-bound estimate for 30 voices stays explicit and small', () => {
  assert.ok(Math.abs(estimateDemoUsd(30) - 0.138) < 1e-9);
  assert.equal(estimateDemoUsd(0), 0);
});

test('duration comes from the data chunk even with trailing bytes', () => {
  const seconds = wavSeconds(fakeAudio);
  assert.ok(seconds > 0);
  assert.equal(wavSeconds(Buffer.concat([fakeAudio, Buffer.alloc(6072)])), seconds);
});

test('demos are generated sequentially with the shared text, skipped when present, and stop at the first failure', async t => {
  const dir = temp(t), calls = [];
  const synthesize = async settings => { calls.push(settings); if (settings.voice === 'Puck') throw Object.assign(new Error('HTTP 429'), { providerBody: '{"error":{}}' }); return { audio: fakeAudio, usage: { total_tokens: 1 } }; };
  const first = await generateDemos({ voices: ['Kore', 'Puck', 'Charon'], dir, synthesize, key: 'test' });
  assert.deepEqual(first, { done: ['Kore'], skipped: [], failed: 'Puck' });
  assert.equal(JSON.parse(readFileSync(join(dir, 'last-error.json'), 'utf8')).voice, 'Puck');
  assert.deepEqual(calls.map(c => c.voice), ['Kore', 'Puck']);
  assert.equal(calls[0].text, demoSettings.text); assert.equal(calls[0].condition, demoSettings.condition); assert.equal(calls[0].model, demoSettings.model);
  assert.ok(existsSync(join(dir, 'Kore.wav')) && !existsSync(join(dir, 'Puck.wav')) && !existsSync(join(dir, 'Charon.wav')));
  const meta = JSON.parse(readFileSync(join(dir, 'Kore.json'), 'utf8'));
  assert.equal(meta.voice, 'Kore'); assert.equal(meta.language, 'ja'); assert.ok(meta.audioSeconds > 0); assert.deepEqual(meta.usage, { total_tokens: 1 });
  calls.length = 0;
  const second = await generateDemos({ voices: ['Kore', 'Charon'], dir, synthesize, key: 'test' });
  assert.deepEqual(second, { done: ['Charon'], skipped: ['Kore'], failed: null });
  assert.deepEqual(calls.map(c => c.voice), ['Charon']);
  assert.deepEqual(Object.keys(readDemos(dir)).sort(), ['Charon', 'Kore']);
  await assert.rejects(generateDemos({ voices: ['Nonexistent'], dir, synthesize, key: 'test' }));
  // A demo made with other text is stale: hidden from the page, regenerated, and the old pair is archived, not deleted.
  const korePath = join(dir, 'Kore.json'), koreMeta = JSON.parse(readFileSync(korePath, 'utf8'));
  writeFileSync(korePath, JSON.stringify({ ...koreMeta, text: 'old text' }));
  assert.equal(demoStatus(dir, 'Kore').state, 'stale');
  assert.deepEqual(Object.keys(readDemos(dir)), ['Charon']);
  calls.length = 0;
  const third = await generateDemos({ voices: ['Kore', 'Charon'], dir, synthesize, key: 'test' });
  assert.deepEqual(third, { done: ['Kore'], skipped: ['Charon'], failed: null });
  assert.equal(demoStatus(dir, 'Kore').state, 'current');
  assert.equal(readdirSync(join(dir, 'superseded')).length, 2);
});

test('quota hint keeps only the quota id and retry delay from a 429 body', async () => {
  const body = { error: { status: 'RESOURCE_EXHAUSTED', message: 'see https://x?key=abc * Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_free_tier, limit: 10, model: m', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaMetric: 'm' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' }] } };
  const hint = quotaHint(JSON.stringify(body));
  assert.equal(hint, ' status=RESOURCE_EXHAUSTED quota=GenerateRequestsPerMinutePerProjectPerModel-FreeTier limit=generativelanguage.googleapis.com/generate_requests_free_tier<=10 retryDelay=41s');
  assert.ok(!hint.includes('key=abc'));
  assert.equal(quotaHint('not json'), '');
  assert.equal(redactProviderBody('x https://a/b?key=AIzaSyABCDEFGHIJKLMNOP&y=1 AIzaSyQRSTUVWXYZ0123456'), 'x https://a/b?key=[REDACTED]&y=1 [REDACTED]');
});

test('interval spaces API calls but not skipped voices', async t => {
  const dir = temp(t), times = [];
  const synthesize = async () => { times.push(performance.now()); return { audio: fakeAudio, usage: null }; };
  await generateDemos({ voices: ['Kore', 'Puck'], dir, synthesize, key: 'test', intervalMs: 60 });
  assert.ok(times[1] - times[0] >= 55);
});

test('server lists and serves only catalog voices from the demo directory', async t => {
  const dir = temp(t), voiceDemoDir = join(dir, 'ja');
  await generateDemos({ voices: ['Kore'], dir: voiceDemoDir, synthesize: async () => ({ audio: fakeAudio, usage: null }), key: 'test' });
  const lab = createLab({ mock: true, dataDir: join(dir, 'mock'), voiceDemoDir });
  const url = await lab.listen(0);
  t.after(() => lab.close());
  const config = JSON.parse((await get(url, '/api/config')).body);
  assert.deepEqual(Object.keys(config.voiceDemos.demos), ['Kore']);
  assert.equal(config.voiceDemos.model, demoSettings.model);
  const audio = await get(url, '/voice-demos/ja/Kore.wav');
  assert.equal(audio.status, 200); assert.equal(audio.type, 'audio/wav'); assert.equal(audio.body.subarray(0, 4).toString(), 'RIFF');
  assert.equal((await get(url, '/voice-demos/ja/Puck.wav')).status, 404);
  assert.equal((await get(url, '/voice-demos/ja/Nonexistent.wav')).status, 404);
  assert.equal((await get(url, '/voice-demos/ja/..%2FKore.wav')).status, 404);
});

test('server serves OpenAI demos from their own directory', async t => {
  const { demoSets } = await import('../lib/voice-demos.mjs');
  const dir = temp(t), openaiVoiceDemoDir = join(dir, 'openai-ja');
  await generateDemos({ voices: ['marin'], dir: openaiVoiceDemoDir, set: demoSets.openai, synthesize: async () => ({ audio: fakeAudio, usage: null, transcript: '' }), key: 'test' });
  const lab = createLab({ mock: true, dataDir: join(dir, 'mock'), voiceDemoDir: join(dir, 'ja'), openaiVoiceDemoDir });
  const url = await lab.listen(0); t.after(() => lab.close());
  const config = JSON.parse((await get(url, '/api/config')).body);
  assert.deepEqual(Object.keys(config.openaiVoiceDemos.demos), ['marin']); assert.equal(config.openaiVoiceDemos.model, 'gpt-realtime-2.1');
  assert.equal((await get(url, '/voice-demos/openai-ja/marin.wav')).status, 200);
  assert.equal((await get(url, '/voice-demos/openai-ja/cedar.wav')).status, 404);
  assert.equal((await get(url, '/voice-demos/openai-ja/Kore.wav')).status, 404);
});
