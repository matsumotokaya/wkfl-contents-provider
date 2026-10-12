import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { buildInterview, validateStudio, useCases, hostPresets, interviewStyles, studioCues, interviewOpening } from '../lib/studio.mjs';
import { validate } from '../lib/catalog.mjs';
import { liveSetup } from '../lib/google.mjs';
import { realtimeSessionUpdate, toRealtimeEvents, connectRealtime } from '../lib/openai.mjs';
import { liveSessionStart, toLiveEvents } from '../lib/openai-live.mjs';
import { Store } from '../lib/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

globalThis.fetch = () => { throw new Error('External fetch forbidden in tests'); };
tls.connect = () => { throw new Error('TLS forbidden in tests'); };

test('the interview instruction carries the show settings and the chosen presets; empty fields are left out', () => {
  const built = buildInterview({ title: 'WKFL インタビュー', guest: '松本', theme: '新規事業のアプリ', profile: '', host: 'bright', style: 'story', extra: '専門用語は避ける' });
  assert.match(built.instruction, /インタビュー番組「WKFL インタビュー」のホスト/);
  assert.match(built.instruction, /ゲストは松本さん/);
  assert.match(built.instruction, /# 今日のテーマ\n新規事業のアプリ/);
  assert.ok(built.instruction.includes(hostPresets.find(p => p.id === 'bright').text));
  assert.ok(built.instruction.includes(interviewStyles.find(p => p.id === 'story').text));
  assert.match(built.instruction, /# 追加の指示\n専門用語は避ける/);
  assert.doesNotMatch(built.instruction, /ゲストについて/);
  assert.equal(built.opening, interviewOpening);
  assert.deepEqual(built.studio, { useCase: 'podcast', format: 'interview', title: 'WKFL インタビュー', theme: '新規事業のアプリ', guest: '松本' });
  const blank = buildInterview({});
  assert.match(blank.instruction, /ゲストを一人迎えています/); assert.doesNotMatch(blank.instruction, /ゲストはゲスト/);
  assert.match(blank.instruction, /まずは自己紹介をお願いする/); assert.match(blank.instruction, /# 番組らしい話し方/);
  assert.match(blank.instruction, /ポッドキャストのパーソナリティ/); assert.match(blank.instruction, /ポッドキャストの王道/);
  assert.doesNotMatch(blank.instruction, /# 今日のテーマ|# 追加の指示|番組「|テーマを一言で/);
});
test('only ready formats are accepted, and studio settings pass through validation', () => {
  assert.equal(useCases[0].formats.find(f => f.id === 'interview').ready, true);
  assert.throws(() => validateStudio({ useCase: 'podcast', format: 'news' }));
  assert.throws(() => validateStudio({ useCase: 'youtube', format: 'interview' }));
  const built = buildInterview({ theme: 'テスト' });
  const settings = validate('live', { model: 'gemini-3.8-live', voice: 'Kore', condition: built.instruction + 'あ'.repeat(2000), opening: built.opening, studio: built.studio, seconds: 900, mode: 'automatic' });
  assert.equal(settings.opening, interviewOpening); assert.equal(settings.studio.format, 'interview');
  assert.throws(() => validate('live', { model: 'gemini-3.8-live', voice: 'Kore', condition: 'あ'.repeat(2000), seconds: 900, mode: 'automatic' }));
});
test('each model keeps its base instruction; in the studio the lab role and the brevity line give way to the show', () => {
  const studio = { useCase: 'podcast', format: 'interview' };
  assert.match(liveSetup({ model: 'gemini-3.8-live', voice: 'Kore', condition: 'ホスト', mode: 'automatic', studio }).setup.systemInstruction.parts[0].text, /^日本語で自然に話してください。\n\nホスト$/);
  assert.match(liveSetup({ model: 'gemini-3.8-live', voice: 'Kore', condition: 'X', mode: 'automatic' }).setup.systemInstruction.parts[0].text, /^日本語で短く自然に対話してください。X$/);
  assert.match(realtimeSessionUpdate({ voice: 'marin', condition: 'ホスト', mode: 'automatic', studio }).session.instructions, /^日本語で自然に話してください。/);
  assert.doesNotMatch(liveSessionStart({ voice: 'marin', condition: 'ホスト', studio }).session.instructions, /議論の相手/);
  assert.match(liveSessionStart({ voice: 'marin', condition: '' }).session.instructions, /議論の相手/);
});
test('a director cue reaches each provider through its instruction channel', () => {
  const text = studioCues['wrap-up'];
  assert.deepEqual(toRealtimeEvents({ instruction: text }), [{ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } }]);
  assert.deepEqual(toLiveEvents({ instruction: text }), [{ type: 'session.instructions.append', content: text, delegation_id: null }]);
});

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; this.readyState = 1; FakeSocket.last = this; setImmediate(() => this.emit('open')); }
  send(data) { this.sent.push(JSON.parse(data)); }
  receive(event) { this.emit('message', JSON.stringify(event)); }
  terminate() { this.readyState = 3; }
}
test('Realtime: an error before setup ends the session; after setup it is recorded and the conversation goes on', async () => {
  const calls = { ready: 0, errors: [], messages: [] };
  const callbacks = { ready: () => calls.ready++, error: info => calls.errors.push(info), message: m => calls.messages.push(m), close() {} };
  connectRealtime({ model: 'gpt-realtime-2.1', voice: 'marin', condition: '', mode: 'automatic' }, callbacks, { key: 'TEST', Socket: FakeSocket });
  await new Promise(resolve => setImmediate(resolve)); const s = FakeSocket.last;
  s.receive({ type: 'session.updated' }); assert.equal(calls.ready, 1);
  s.receive({ type: 'error', error: { code: 'conversation_already_has_active_response' } });
  assert.equal(calls.errors.length, 0); assert.equal(calls.messages.at(-1).providerEvent.name, 'error');
  s.receive({ type: 'input_audio_buffer.speech_started', item_id: 'item_1' });
  s.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: 'はい' });
  assert.ok(Number.isFinite(calls.messages.at(-1).serverContent.inputTranscription.spokenAt));
  connectRealtime({ model: 'gpt-realtime-2.1', voice: 'marin', condition: '', mode: 'automatic' }, callbacks, { key: 'TEST', Socket: FakeSocket });
  await new Promise(resolve => setImmediate(resolve));
  FakeSocket.last.receive({ type: 'error', error: { code: 'invalid_api_key' } });
  assert.equal(calls.errors.length, 1);
});
test('studio episodes are pruned separately from lab sessions of the same model', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-studio-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'data'));
  const make = (studio, i) => { const item = store.begin('live', { model: 'gemini-3.8-live', voice: 'Kore', ...(studio ? { studio: { useCase: 'podcast', format: 'interview' } } : {}) }, false); item.createdAt = new Date(Date.UTC(2026, 9, 12, 0, i)).toISOString(); item.status = 'completed'; store.save(item); return item; };
  for (let i = 0; i < 6; i++) make(false, i);
  const episodes = [0, 1].map(i => make(true, i));
  const moved = store.prune(5, join(dir, 'trash'));
  assert.equal(moved.length, 1);
  const kept = store.list().map(item => item.id);
  assert.ok(episodes.every(item => kept.includes(item.id)));
});
