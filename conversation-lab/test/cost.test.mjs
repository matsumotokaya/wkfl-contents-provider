import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLive, countModelTurns, fxSnapshot } from '../lib/cost.mjs';
const base = { model: 'gemini-3.8-live', createdAt:'2026-10-11T03:06:16.937Z', endedAt:'2026-10-11T03:07:10.807Z', recording:{durationMs:52536} };
const row = {atMs:19165,source:'google-live',value:{promptTokenCount:849,responseTokenCount:50,thoughtsTokenCount:58,promptTokensDetails:[{modality:'TEXT',tokenCount:357},{modality:'AUDIO',tokenCount:441}],responseTokensDetails:[{modality:'AUDIO',tokenCount:50}]}};
const turn = role => ({ type: 'transcript', role, text: 'x' });
// 357×0.75 + 441×3 + 50×12 + unclassified 51×0.75 + thinking 58×4.5 = 2490 per 1M
const perNotice = 0.00249;

test('each notice is priced in full, including thinking and unclassified input at the text rates', () => {
  const s = summarizeLive({ ...base, usage: [row], events: [turn('model')] });
  assert.equal(s.elapsedSeconds, 53.87); assert.equal(s.recordingSeconds, 52.536);
  assert.ok(Math.abs(s.observations[0].usd - perNotice) < 1e-12);
  assert.equal(s.observations[0].inputUnclassified, 51);
  const assumed = s.observations[0].lines.filter(l => l.assumed).map(l => [l.modality, l.tokens, l.rate]);
  assert.deepEqual(assumed, [['UNCLASSIFIED', 51, 0.75], ['THINKING', 58, 4.5]]);
  assert.equal(s.finalUsageConfirmed, true); assert.equal(s.missingNotices, 0);
});

test('the session estimate is the sum of notices, shown in yen at the recorded rate', () => {
  const s = summarizeLive({ ...base, usage: [row, row], events: [turn('model'), turn('user'), turn('model')] });
  assert.ok(Math.abs(s.sessionUsd - 2 * perNotice) < 1e-12);
  assert.ok(Math.abs(s.sessionJpy - 2 * perNotice * fxSnapshot.usdJpy) < 1e-9);
  assert.deepEqual(s.tokens, { input: 1698, output: 100, thinking: 116 });
  assert.equal(s.aggregation, 'sum-of-notices');
});

test('a reply cut off before its notice is reported as missing', () => {
  const s = summarizeLive({ ...base, usage: [row], events: [turn('model'), turn('model'), turn('user'), turn('model')] });
  assert.equal(s.modelTurns, 2); assert.equal(s.missingNotices, 1); assert.equal(s.finalUsageConfirmed, false);
  assert.equal(countModelTurns([turn('user'), turn('model'), turn('model')]), 1);
});

test('missing usage, counts, times and unsupported modalities stay unknown', () => {
  const s = summarizeLive({ model: base.model, usage: [{ source: 'google-live', value: { promptTokensDetails: [{ modality: 'AUDIO' }, { modality: 'UNKNOWN', tokenCount: 42 }] } }] });
  assert.equal(s.elapsedSeconds, null); assert.equal(s.recordingSeconds, null);
  assert.equal(s.observations[0].usd, null); assert.equal(s.observations[0].promptTokens, null);
  assert.equal(s.observations[0].lines[0].tokens, null);
  assert.equal(s.sessionUsd, null); assert.equal(s.sessionJpy, null);
  assert.equal(summarizeLive({ ...base, usage: [] }).sessionUsd, null);
  assert.equal(summarizeLive({ ...base, mock: true }), null);
  assert.equal(summarizeLive({ ...base, model: 'other' }), null);
});
