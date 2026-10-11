import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realtimeSessionUpdate, toRealtimeEvents, fromRealtimeEvent } from '../lib/openai.mjs';
import { openaiVoiceSnippets } from '../lib/snippets.mjs';
import { upsample16kTo24k, wav } from '../lib/audio.mjs';
import { validate, openaiVoiceProfiles } from '../lib/catalog.mjs';
import { summarizeLive } from '../lib/cost.mjs';
import { openaiCredentialSource, loadOpenAIKey } from '../lib/credentials.mjs';

globalThis.fetch = () => { throw new Error('External fetch forbidden in tests'); };
tls.connect = () => { throw new Error('TLS forbidden in tests'); };

test('session update asks for 24 kHz PCM both ways, the chosen voice, and Japanese transcription', () => {
  const update = realtimeSessionUpdate({ voice: 'marin', condition: '短く', mode: 'automatic' });
  assert.equal(update.type, 'session.update'); assert.equal(update.session.type, 'realtime');
  assert.deepEqual(update.session.audio.input.format, { type: 'audio/pcm', rate: 24000 });
  assert.deepEqual(update.session.audio.output.format, { type: 'audio/pcm', rate: 24000 });
  assert.equal(update.session.audio.output.voice, 'marin');
  assert.equal(update.session.audio.input.turn_detection.type, 'semantic_vad');
  assert.equal(realtimeSessionUpdate({ voice: 'marin', condition: '', mode: 'manual' }).session.audio.input.turn_detection, null);
  assert.ok(update.session.instructions.endsWith('短く'));
});

test('server messages become OpenAI client events', () => {
  const pcm16k = Buffer.alloc(3200);
  const [append] = toRealtimeEvents({ realtimeInput: { audio: { data: pcm16k.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } });
  assert.equal(append.type, 'input_audio_buffer.append');
  assert.equal(Buffer.from(append.audio, 'base64').length, 4800);
  assert.deepEqual(toRealtimeEvents({ realtimeInput: { text: 'こんにちは' } }), [{ type: 'response.create', response: { instructions: 'こんにちは' } }]);
  assert.deepEqual(toRealtimeEvents({ realtimeInput: { activityEnd: {} } }).map(e => e.type), ['input_audio_buffer.commit', 'response.create']);
  assert.deepEqual(toRealtimeEvents({ unknown: true }), []);
});

test('OpenAI server events become the Live message shape, with usage kept raw', () => {
  assert.equal(fromRealtimeEvent({ type: 'response.output_audio.delta', delta: 'AAAA' }).serverContent.modelTurn.parts[0].inlineData.data, 'AAAA');
  assert.equal(fromRealtimeEvent({ type: 'response.output_audio_transcript.delta', delta: 'はい' }).serverContent.outputTranscription.text, 'はい');
  assert.equal(fromRealtimeEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'こんにちは' }).serverContent.inputTranscription.text, 'こんにちは');
  assert.equal(fromRealtimeEvent({ type: 'input_audio_buffer.speech_started' }).serverContent.interrupted, true);
  const done = fromRealtimeEvent({ type: 'response.done', response: { usage: { input_tokens: 1 } } });
  assert.equal(done.serverContent.turnComplete, true); assert.deepEqual(done.providerUsage, { source: 'openai-realtime', value: { input_tokens: 1 } });
  assert.equal(fromRealtimeEvent({ type: 'rate_limits.updated' }), null);
});

test('16 kHz to 24 kHz keeps 1.5x frames and the original endpoints', () => {
  const pcm = Buffer.alloc(8); [0, 1000, 2000, 3000].forEach((v, i) => pcm.writeInt16LE(v, i * 2));
  const out = upsample16kTo24k(pcm);
  assert.equal(out.length, 12); assert.equal(out.readInt16LE(0), 0); assert.equal(out.readInt16LE(2 * 3), 2000);
});

test('voices are checked per provider', () => {
  const base = { condition: '', seconds: 30, mode: 'automatic' };
  assert.equal(validate('live', { ...base, model: 'gpt-realtime-2.1', voice: 'marin' }).provider, 'openai');
  assert.throws(() => validate('live', { ...base, model: 'gpt-realtime-2.1', voice: 'Kore' }));
  assert.throws(() => validate('live', { ...base, model: 'gemini-3.8-live', voice: 'marin' }));
  assert.equal(validate('live', { ...base, model: 'gemini-3.8-live', voice: 'Kore' }).provider, 'google');
});

test('published OpenAI code matches the session update the app sends', () => {
  const marin = openaiVoiceProfiles.voices.find(v => v.name === 'marin');
  const [prompt, code] = openaiVoiceSnippets(marin, { model: 'gpt-realtime-2.1', checkedAt: '2026-10-11' });
  assert.ok(prompt.text.includes('gpt-realtime-2.1') && prompt.text.includes('"marin"'));
  assert.deepEqual(JSON.parse(code.text), realtimeSessionUpdate({ voice: 'marin', condition: '', mode: 'automatic' }));
});

test('OpenAI usage is priced with cached input and separate transcription', () => {
  const usage = { input_tokens: 1000, output_tokens: 300, input_token_details: { text_tokens: 400, audio_tokens: 600, cached_tokens: 500, cached_tokens_details: { text_tokens: 300, audio_tokens: 200 } }, output_token_details: { text_tokens: 50, audio_tokens: 250 } };
  const item = { model: 'gpt-realtime-2.1', createdAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:30Z', events: [{ type: 'transcript', role: 'model', text: 'x' }],
    usage: [{ atMs: 5000, source: 'openai-realtime', value: usage }, { atMs: 3000, source: 'openai-transcription', value: { type: 'tokens', input_tokens: 40, output_tokens: 10 } }] };
  const s = summarizeLive(item);
  // text 100×4 + cached text 300×0.4 + audio 400×32 + cached audio 200×0.4 + out text 50×24 + out audio 250×64 = 30600
  assert.ok(Math.abs(s.observations[0].usd - 0.0306) < 1e-12);
  // transcription 40×1.25 + 10×5 = 100
  assert.ok(Math.abs(s.observations[1].usd - 0.0001) < 1e-12);
  assert.ok(Math.abs(s.sessionUsd - 0.0307) < 1e-12);
  assert.equal(s.observations[1].kind, 'transcription'); assert.equal(s.missingNotices, 0);
  assert.deepEqual(s.tokens, { input: 1000, output: 300, thinking: 0 });
});

test('OpenAI key comes only from an explicit file or the central WKFL file', t => {
  const home = mkdtempSync(join(tmpdir(), 'wkfl-openai-key-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  assert.equal(openaiCredentialSource({ env: { OPENAI_API_KEY: 'other-project' }, home }).type, 'missing');
  assert.throws(() => loadOpenAIKey({ env: { OPENAI_API_KEY: 'other-project' }, home }));
  mkdirSync(join(home, '.secrets', 'wkfl'), { recursive: true }); writeFileSync(join(home, '.secrets', 'wkfl', 'openai-token'), 'TEST_VALUE\n');
  assert.equal(loadOpenAIKey({ env: {}, home }), 'TEST_VALUE');
  assert.equal(loadOpenAIKey({ env: {}, home, mock: true }), undefined);
});

import { EventEmitter } from 'node:events';
import { speakRealtime, realtimeReadInstruction } from '../lib/openai.mjs';
import { demoSets, generateDemos, readDemos } from '../lib/voice-demos.mjs';
import { existsSync } from 'node:fs';
class FakeSocket extends EventEmitter {
  static OPEN = 1;
  constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; this.readyState = 1; FakeSocket.last = this; setImmediate(() => this.emit('open')); }
  send(data) {
    const event = JSON.parse(data); this.sent.push(event);
    const reply = (...events) => setImmediate(() => events.forEach(e => this.emit('message', JSON.stringify(e))));
    if (event.type === 'session.update') reply({ type: 'session.updated' });
    if (event.type === 'response.create') reply(
      { type: 'response.output_audio.delta', delta: Buffer.alloc(4800).toString('base64') },
      { type: 'response.output_audio_transcript.delta', delta: FakeSocket.transcript ?? 'こんにちは' },
      { type: 'response.done', response: { status: FakeSocket.status ?? 'completed', usage: { output_tokens: 5 } } });
  }
  terminate() { this.readyState = 3; }
}

test('one-shot Realtime reading sends the voice, the read-only instruction and the text, and returns WAV + transcript', async () => {
  FakeSocket.status = undefined; FakeSocket.transcript = undefined;
  const result = await speakRealtime({ model: 'gpt-realtime-2.1', voice: 'cedar', text: 'こんにちは', condition: '' }, { key: 'TEST', Socket: FakeSocket });
  assert.equal(result.audio.subarray(0, 4).toString(), 'RIFF'); assert.equal(result.transcript, 'こんにちは'); assert.deepEqual(result.usage, { output_tokens: 5 });
  const s = FakeSocket.last;
  assert.equal(s.options.headers.Authorization, 'Bearer TEST'); assert.match(s.url, /model=gpt-realtime-2\.1$/);
  assert.deepEqual(s.sent.map(e => e.type), ['session.update', 'conversation.item.create', 'response.create']);
  assert.equal(s.sent[0].session.audio.output.voice, 'cedar'); assert.ok(s.sent[0].session.instructions.startsWith(realtimeReadInstruction));
  assert.equal(s.sent[1].item.content[0].text, 'こんにちは');
});

test('a failed Realtime response rejects instead of saving a demo', async () => {
  FakeSocket.status = 'failed';
  await assert.rejects(speakRealtime({ model: 'gpt-realtime-2.1', voice: 'cedar', text: 'x', condition: '' }, { key: 'TEST', Socket: FakeSocket }), /Response failed/);
  FakeSocket.status = undefined;
});

test('OpenAI demos record whether the transcript matches the text, ignoring spaces and punctuation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-openai-demo-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const set = demoSets.openai;
  const synth = async settings => ({ audio: wav(Buffer.alloc(480), 24000), usage: null, transcript: settings.voice === 'marin' ? set.text.replace(/、/g, ' ') : 'はい、読み上げます。' + set.text });
  const result = await generateDemos({ voices: ['marin', 'cedar'], dir, set, synthesize: synth, key: 'TEST' });
  assert.deepEqual(result.done, ['marin', 'cedar']);
  const demos = readDemos(dir, set);
  assert.equal(demos.marin.transcriptMatches, true); assert.equal(demos.cedar.transcriptMatches, false);
  assert.ok(existsSync(join(dir, 'marin.wav')));
  await assert.rejects(generateDemos({ voices: ['Kore'], dir, set, synthesize: synth, key: 'TEST' }));
});
