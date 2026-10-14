import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import tls from 'node:tls';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLab } from '../server.mjs';
import { synthesize, ttsRequest } from '../lib/minimax.mjs';
import { validate } from '../lib/catalog.mjs';
import { summarizeTts } from '../lib/cost.mjs';
import { loadMinimaxKey, minimaxCredentialSource } from '../lib/credentials.mjs';
import { wav, mockTone } from '../lib/audio.mjs';

globalThis.fetch = () => { throw new Error('External fetch forbidden in tests'); };
tls.connect = () => { throw new Error('TLS forbidden in tests'); };
const settings = { provider: 'minimax', model: 'speech-2.8-hd', voice: 'nijiVoiceRefA01', text: 'テスト', condition: '' };
const reply = body => async () => ({ ok: true, json: async () => body });
const success = (extra = {}) => ({ data: { audio: wav(mockTone(), 32000).toString('hex'), status: 2 }, extra_info: { usage_characters: 3, audio_length: 500, audio_format: 'wav', invisible_character_ratio: 0, ...extra }, trace_id: 'trace-1', base_resp: { status_code: 0, status_msg: 'success' } });

test('MiniMax request: clone voice id, Japanese boost, WAV hex, no emotion', () => {
  const body = ttsRequest(settings);
  assert.equal(body.voice_setting.voice_id, 'nijiVoiceRefA01'); assert.equal(body.voice_setting.emotion, undefined);
  assert.equal(body.language_boost, 'Japanese'); assert.deepEqual(body.audio_setting, { format: 'wav', sample_rate: 32000, channel: 1 });
  assert.equal(body.output_format, 'hex'); assert.equal(body.stream, false); assert.equal(body.text, 'テスト');
});
test('MiniMax response: hex WAV is decoded and only billing fields are kept', async () => {
  let sent;
  const result = await synthesize(settings, { key: 'FAKE_TEST_VALUE', mock: false, fetcher: async (url, init) => { sent = { url, init }; return reply(success({ usage_voice_count: 1 }))(); } });
  assert.equal(sent.url, 'https://api.minimax.io/v1/t2a_v2'); assert.equal(sent.init.headers.Authorization, 'Bearer FAKE_TEST_VALUE');
  assert.equal(result.audio.subarray(0, 4).toString(), 'RIFF');
  assert.deepEqual(result.usage, { usage_characters: 3, usage_voice_count: 1, audio_length: 500, audio_format: 'wav', trace_id: 'trace-1' });
});
test('MiniMax failures keep only the HTTP status or numeric status code', async () => {
  const fail = body => synthesize(settings, { key: 'k', mock: false, fetcher: reply(body) });
  await assert.rejects(fail({ base_resp: { status_code: 1004, status_msg: 'secret detail' } }), error => error.message === 'MiniMax request failed (status_code 1004)');
  await assert.rejects(fail({ data: { audio: 'zz' }, base_resp: { status_code: 0 } }), /No audio returned/);
  await assert.rejects(fail({ data: { audio: Buffer.from('ID3 not a wav').toString('hex') }, base_resp: { status_code: 0 } }), /Expected WAV/);
  await assert.rejects(synthesize(settings, { key: 'k', mock: false, fetcher: async () => ({ ok: false, status: 401, text: async () => 'secret detail' }) }), error => error.message === 'MiniMax request failed (HTTP 401)');
});
test('catalog: MiniMax models take only MiniMax voices and drop the unused condition', () => {
  assert.deepEqual(validate('tts', { model: 'speech-2.8-turbo', voice: 'nijiVoiceRefA01', text: 'こんにちは', condition: '明るく' }), { provider: 'minimax', model: 'speech-2.8-turbo', voice: 'nijiVoiceRefA01', condition: '', text: 'こんにちは' });
  assert.throws(() => validate('tts', { model: 'speech-2.8-hd', voice: 'Kore', text: 'x' }));
  assert.throws(() => validate('tts', { model: 'gemini-3.8-flash-tts', voice: 'nijiVoiceRefA01', text: 'x' }));
  assert.equal(validate('tts', { model: 'gemini-3.8-flash-tts', voice: 'Kore', text: 'x', condition: 'calm' }).condition, 'calm');
});
test('cost: characters × rate, plus the one-time clone fee only on the activating call', () => {
  const item = extra => ({ kind: 'tts', model: 'speech-2.8-hd', mock: false, usage: [{ source: 'minimax-t2a', value: { usage_characters: 591, ...extra } }] });
  assert.ok(Math.abs(summarizeTts(item({})).usd - 0.0591) < 1e-9);
  const first = summarizeTts(item({ usage_voice_count: 1 }));
  assert.equal(first.activations, 1); assert.ok(Math.abs(first.usd - 1.5591) < 1e-9);
  assert.equal(summarizeTts({ ...item({}), model: 'speech-2.8-turbo' }).pricing.perMillionChars, 60);
  assert.equal(summarizeTts({ ...item({}), mock: true }), null);
  assert.equal(summarizeTts({ kind: 'tts', model: 'gemini-3.8-flash-tts', usage: [] }), null);
});
test('credentials: shared home file or explicit file only; MINIMAX_API_KEY is ignored', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-lab-minimax-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { MINIMAX_API_KEY: 'fake-from-dotenv' };
  assert.equal(minimaxCredentialSource({ env, home: dir }).type, 'missing');
  assert.throws(() => loadMinimaxKey({ env, home: dir }), /not configured/);
  mkdirSync(join(dir, '.secrets', 'wkfl'), { recursive: true });
  writeFileSync(join(dir, '.secrets', 'wkfl', 'minimax-token'), 'fake-wkfl-only');
  assert.equal(minimaxCredentialSource({ env, home: dir }).type, 'missing');
  writeFileSync(join(dir, '.secrets', 'minimax-token'), 'fake-shared\n');
  assert.equal(loadMinimaxKey({ env, home: dir }), 'fake-shared');
  const explicit = join(dir, 'explicit'); writeFileSync(explicit, 'fake-explicit');
  assert.equal(loadMinimaxKey({ env: { MINIMAX_API_KEY_FILE: explicit }, home: dir }), 'fake-explicit');
  assert.throws(() => minimaxCredentialSource({ env: { MINIMAX_API_KEY_FILE: 'relative' }, home: dir }));
  assert.equal(loadMinimaxKey({ env, home: '/missing', mock: true }), undefined);
});
test('server routes MiniMax models to the MiniMax provider and records its usage source', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-lab-minimax-server-'));
  const calls = [];
  const lab = createLab({ mock: true, dataDir: dir, provider: {
    synthesize: async () => { calls.push('google'); return { audio: wav(mockTone(), 24000), usage: null }; },
    synthesizeMinimax: async (s, options) => { calls.push(['minimax', s.voice, options.mock]); return { audio: wav(mockTone(), 32000), usage: { usage_characters: 3 } }; },
  } });
  const url = await lab.listen(0);
  t.after(async () => { await lab.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request(url + path, { method: body ? 'POST' : 'GET', headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(Buffer.concat(chunks)) })); });
    req.on('error', reject); req.end(body && JSON.stringify(body));
  });
  const config = (await call('/api/config')).value;
  assert.equal(config.minimaxCredentialSource, 'mock-no-key-read'); assert.equal(config.minimaxVoiceProfiles.voices[0].name, 'nijiVoiceRefA01');
  const result = await call('/api/tts', { model: 'speech-2.8-hd', voice: 'nijiVoiceRefA01', text: 'テスト', condition: '無視される' }, { Origin: url, 'X-Lab-Token': config.csrf, 'Content-Type': 'application/json' });
  assert.equal(result.status, 200); assert.deepEqual(calls, [['minimax', 'nijiVoiceRefA01', true]]);
  assert.equal(result.value.condition, ''); assert.deepEqual(result.value.usage, [{ source: 'minimax-t2a', value: { usage_characters: 3 } }]);
  assert.equal(result.value.costSummary, null);
});
