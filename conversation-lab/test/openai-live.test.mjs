import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { liveSessionStart, toLiveEvents, fromLiveEvent, connectGptLive } from '../lib/openai-live.mjs';
import { gptLiveVoiceSnippets } from '../lib/snippets.mjs';
import { validate, gptLiveVoiceProfiles } from '../lib/catalog.mjs';
import { summarizeLive } from '../lib/cost.mjs';

globalThis.fetch = () => { throw new Error('External fetch forbidden in tests'); };
tls.connect = () => { throw new Error('TLS forbidden in tests'); };
const settings = { model: 'gpt-live-1', voice: 'quartz', condition: '反論も遠慮なく', mode: 'automatic', delegate: 'gpt-6-sol' };

test('session.start names gpt-live-1, the voice, the instructions and Responses delegation', () => {
  const { type, session } = liveSessionStart(settings);
  assert.equal(type, 'session.start'); assert.equal(session.model, 'gpt-live-1');
  assert.deepEqual(session.audio, { output: { voice: 'quartz' } });
  assert.ok(session.instructions.includes('委任') && session.instructions.endsWith('反論も遠慮なく'));
  assert.equal(session.delegation.type, 'responses'); assert.equal(session.delegation.responses.model, 'gpt-6-sol');
  assert.equal(liveSessionStart({ voice: 'marin' }).session.delegation.responses.model, 'gpt-6-luna');
});

test('server messages and GPT-Live events translate both ways', () => {
  const [append] = toLiveEvents({ realtimeInput: { audio: { data: Buffer.alloc(3200).toString('base64') } } });
  assert.equal(append.type, 'session.input_audio.append'); assert.equal(Buffer.from(append.audio, 'base64').length, 4800);
  assert.deepEqual(toLiveEvents({ realtimeInput: { text: 'こんにちは' } }), [{ type: 'session.instructions.append', content: 'こんにちは', delegation_id: null }]);
  assert.deepEqual(toLiveEvents({ realtimeInput: { activityEnd: {} } }), []);
  assert.equal(fromLiveEvent({ type: 'session.output_audio.delta', delta: 'AAAA' }).serverContent.modelTurn.parts[0].inlineData.data, 'AAAA');
  assert.equal(fromLiveEvent({ type: 'session.input_transcript.delta', delta: 'こん' }).serverContent.inputTranscription.text, 'こん');
  assert.equal(fromLiveEvent({ type: 'session.output_transcript.delta', delta: 'はい' }).serverContent.outputTranscription.text, 'はい');
  assert.deepEqual(fromLiveEvent({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 61 } }).providerUsage, { source: 'openai-live-voice', value: { seconds: 61, final: true, reason: 'close_requested' } });
  assert.equal(fromLiveEvent({ type: 'session.usage.updated', usage: { seconds: 30 } }).providerUsage.value.final, false);
  assert.equal(fromLiveEvent({ type: 'session.delegation.created', delegation: { target: 'responses' } }).providerEvent.name, 'delegation-created');
  assert.deepEqual(fromLiveEvent({ type: 'response.event', event: { type: 'response.completed', response: { model: 'gpt-6-luna', usage: { input_tokens: 10 } } } }).providerUsage, { source: 'openai-live-backend', value: { model: 'gpt-6-luna', usage: { input_tokens: 10 } } });
  assert.equal(fromLiveEvent({ type: 'response.event', event: { type: 'response.output_text.delta' } }), null);
  assert.equal(fromLiveEvent({ type: 'something.else' }), null);
});

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; this.readyState = 1; FakeSocket.last = this; setImmediate(() => this.emit('open')); }
  send(data) { this.sent.push(JSON.parse(data)); }
  receive(event) { this.emit('message', JSON.stringify(event)); }
  terminate() { this.readyState = 3; this.terminated = true; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function recorder() {
  const calls = { ready: 0, errors: [], messages: [], closes: [] };
  return { calls, callbacks: { ready: () => calls.ready++, error: info => calls.errors.push(info), message: m => calls.messages.push(m), close: info => calls.closes.push(info) } };
}

test('connection starts the session, becomes ready, keeps going after a command error, and closes gracefully', async () => {
  const { calls, callbacks } = recorder();
  const live = connectGptLive(settings, callbacks, { key: 'TEST', Socket: FakeSocket });
  await tick(); const s = FakeSocket.last;
  assert.equal(s.url, 'wss://api.openai.com/v1/live/sessions'); assert.equal(s.options.headers.Authorization, 'Bearer TEST');
  assert.equal(s.sent[0].type, 'session.start');
  s.receive({ type: 'session.started', session: { id: 'sess_1' } }); assert.equal(calls.ready, 1);
  s.receive({ type: 'error', error: { code: 'moderation', message: 'cut' } });
  assert.equal(calls.errors.length, 0); assert.equal(calls.messages.at(-1).providerEvent.name, 'error');
  live.send({ realtimeInput: { text: '挨拶して' } }); assert.equal(s.sent.at(-1).type, 'session.instructions.append');
  live.close();
  assert.equal(s.sent.at(-1).type, 'session.close');
  s.receive({ type: 'session.output_transcript.delta', delta: 'ignored after close' });
  s.receive({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 42 } });
  const usage = calls.messages.filter(m => m.providerUsage);
  assert.equal(usage.length, 1); assert.equal(usage[0].providerUsage.value.seconds, 42);
  assert.ok(s.terminated); assert.equal(calls.closes.length, 0);
  assert.equal(calls.messages.filter(m => m.serverContent?.outputTranscription).length, 0);
});

test('a startup error ends the session', async () => {
  const { calls, callbacks } = recorder();
  connectGptLive(settings, callbacks, { key: 'TEST', Socket: FakeSocket }); await tick();
  FakeSocket.last.receive({ type: 'error', error: { code: 'forbidden', message: 'Voice session access denied.' } });
  assert.equal(calls.errors.length, 1); assert.equal(calls.ready, 0);
});

test('GPT-Live accepts its voices and delegates, automatic turns only', () => {
  const base = { model: 'gpt-live-1', condition: '', seconds: 60, mode: 'automatic' };
  const ok = validate('live', { ...base, voice: 'quartz' });
  assert.equal(ok.provider, 'openai-live'); assert.equal(ok.delegate, 'gpt-6-luna');
  assert.equal(validate('live', { ...base, voice: 'marin', delegate: 'gpt-6-sol' }).delegate, 'gpt-6-sol');
  assert.throws(() => validate('live', { ...base, voice: 'quartz', mode: 'manual' }));
  assert.throws(() => validate('live', { ...base, voice: 'quartz', delegate: 'gpt-6-astra' }));
  assert.throws(() => validate('live', { ...base, voice: 'Kore' }));
  assert.equal(gptLiveVoiceProfiles.voices.length, 13);
});

test('cost: voice seconds (final wins, elapsed as fallback) plus backend tokens', () => {
  const base = { model: 'gpt-live-1', createdAt: '2026-10-12T00:00:00Z', endedAt: '2026-10-12T00:01:00Z', events: [] };
  const usage = [
    { atMs: 30000, source: 'openai-live-voice', value: { seconds: 30, final: false } },
    { atMs: 61000, source: 'openai-live-voice', value: { seconds: 48, final: true, reason: 'close_requested' } },
    { atMs: 20000, source: 'openai-live-backend', value: { model: 'gpt-6-luna-2026-09-01', usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 500, output_tokens_details: { reasoning_tokens: 300 } } } },
  ];
  const s = summarizeLive({ ...base, usage });
  assert.equal(s.observations[0].seconds, 48); assert.equal(s.observations[0].assumed, false); assert.equal(s.finalUsageConfirmed, true);
  // voice 48/60 × 0.05 = 0.04; backend 800×0.1 + 200×0.01 + 500×0.5 = 332 per 1M
  assert.ok(Math.abs(s.observations[1].usd - 0.000332) < 1e-12);
  assert.ok(Math.abs(s.sessionUsd - 0.040332) < 1e-12);
  assert.deepEqual(s.tokens, { input: 1000, output: 500, thinking: 300 });
  const fallback = summarizeLive({ ...base, usage: [] });
  assert.equal(fallback.observations[0].seconds, 60); assert.equal(fallback.observations[0].assumed, true);
  assert.ok(Math.abs(fallback.sessionUsd - 0.05) < 1e-12); assert.equal(fallback.finalUsageConfirmed, false);
  // Snapshots lag behind: without the final value the elapsed time (60 s) beats the last snapshot (46 s).
  const lagging = summarizeLive({ ...base, usage: [{ atMs: 46000, source: 'openai-live-voice', value: { seconds: 46, final: false } }] });
  assert.equal(lagging.observations[0].seconds, 60); assert.equal(lagging.observations[0].assumed, true);
});

test('published GPT-Live code matches the session.start the app sends', () => {
  const quartz = gptLiveVoiceProfiles.voices.find(v => v.name === 'quartz');
  const [prompt, code] = gptLiveVoiceSnippets(quartz, { delegate: 'gpt-6-sol', checkedAt: '2026-10-12' });
  assert.ok(prompt.text.includes('"quartz"') && prompt.text.includes('gpt-6-sol'));
  assert.deepEqual(JSON.parse(code.text), liveSessionStart({ voice: 'quartz', delegate: 'gpt-6-sol' }));
});
