// USD per 1M tokens, checked 2026-10-11. Gemini: https://ai.google.dev/gemini-api/docs/pricing
// OpenAI: https://developers.openai.com/api/docs/pricing
export const livePricing = Object.freeze({
  provider: 'google', model: 'gemini-3.8-live', checkedAt: '2026-10-11', currency: 'USD', unit: '1M tokens',
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  usageSource: 'https://ai.google.dev/api/live',
  input: { TEXT: 0.75, AUDIO: 3, IMAGE: 1, VIDEO: 1 }, output: { TEXT: 4.5, AUDIO: 12 }
});
const openaiPricing = (model, input, cached, output) => Object.freeze({
  provider: 'openai', model, checkedAt: '2026-10-11', currency: 'USD', unit: '1M tokens',
  source: 'https://developers.openai.com/api/docs/pricing',
  usageSource: 'https://developers.openai.com/api/docs/guides/realtime-costs',
  input, cachedInput: cached, output,
  // Input audio transcription runs on a separate model with its own rate card.
  transcription: { model: 'gpt-4o-mini-transcribe', input: 1.25, output: 5 },
});
export const pricingByModel = Object.freeze({
  'gemini-3.8-live': livePricing,
  'gpt-realtime-2.1': openaiPricing('gpt-realtime-2.1', { TEXT: 4, AUDIO: 32 }, { TEXT: 0.4, AUDIO: 0.4 }, { TEXT: 24, AUDIO: 64 }),
  'gpt-realtime-2.1-mini': openaiPricing('gpt-realtime-2.1-mini', { TEXT: 0.6, AUDIO: 10 }, { TEXT: 0.06, AUDIO: 0.3 }, { TEXT: 2.4, AUDIO: 20 }),
  // GPT-Live: voice billed per second of session; the delegated backend model is billed separately by tokens (checked 2026-10-12).
  'gpt-live-1': Object.freeze({
    provider: 'openai-live', model: 'gpt-live-1', checkedAt: '2026-10-12', currency: 'USD', unit: 'minute + 1M tokens',
    source: 'https://developers.openai.com/api/docs/pricing',
    usageSource: 'https://developers.openai.com/api/docs/guides/live-conversations',
    voicePerMinute: 0.05,
    backend: { 'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 }, 'gpt-6-sol': { input: 2, cachedInput: 0.2, output: 10 } },
  }),
});
// Reference rate for showing yen. Update together with prices before publishing.
export const fxSnapshot = Object.freeze({
  usdJpy: 158.25, date: '2026-10-09', label: '欧州中央銀行（ECB）の参考レート',
  source: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY',
});
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const line = (direction, modality, tokens, rate, assumed = false) => ({ direction, modality, tokens, rate: rate ?? null, usd: tokens !== null && rate !== undefined ? tokens * rate / 1e6 : null, assumed });
const priced = lines => { const known = lines.filter(l => l.usd !== null); return known.length ? known.reduce((sum, l) => sum + l.usd, 0) : null; };
// One model reply = one run of consecutive model transcript fragments.
export function countModelTurns(events = []) {
  let turns = 0, previous = null;
  for (const event of events) {
    if (event.type !== 'transcript') continue;
    if (event.role === 'model' && previous !== 'model') turns++;
    previous = event.role;
  }
  return turns;
}
// Gemini: each notice covers one model reply and its prompt re-reads the whole conversation.
// Assumptions (not stated by Google): thinking uses the text output rate; input without a modality
// breakdown uses the text input rate.
function geminiObservation(row, p) {
  const value = row.value || {}, lines = [];
  for (const [direction, field] of [['input', 'promptTokensDetails'], ['output', 'responseTokensDetails']]) {
    for (const detail of value[field] || []) lines.push(line(direction, detail.modality, count(detail.tokenCount), p[direction][detail.modality]));
  }
  const residual = (direction, total) => {
    const subset = lines.filter(l => l.direction === direction);
    return count(total) !== null && subset.length && subset.every(l => l.tokens !== null) ? total - subset.reduce((sum, l) => sum + l.tokens, 0) : null;
  };
  const inputUnclassified = residual('input', value.promptTokenCount), outputUnclassified = residual('output', value.responseTokenCount);
  if (inputUnclassified > 0) lines.push(line('input', 'UNCLASSIFIED', inputUnclassified, p.input.TEXT, true));
  const thoughtsTokens = count(value.thoughtsTokenCount);
  if (thoughtsTokens) lines.push(line('output', 'THINKING', thoughtsTokens, p.output.TEXT, true));
  return { kind: 'response', atMs: row.atMs ?? null, promptTokens: count(value.promptTokenCount), responseTokens: count(value.responseTokenCount), thoughtsTokens, inputUnclassified, outputUnclassified, lines, usd: priced(lines) };
}
// OpenAI: "The entire conversation is sent to the model for each Response" (realtime-costs guide).
// Cached input is a subset of input and billed at the cached rate.
// output_token_details.reasoning_tokens is a subset of text_tokens (output_tokens = text + audio in observed usage), so it is not added again.
function openaiObservation(row, p) {
  const u = row.value || {}, inDetail = u.input_token_details || {}, cached = inDetail.cached_tokens_details || {}, outDetail = u.output_token_details || {}, lines = [];
  for (const [modality, field] of [['TEXT', 'text_tokens'], ['AUDIO', 'audio_tokens']]) {
    const total = count(inDetail[field]), hit = count(cached[field]) ?? 0;
    if (total !== null) {
      lines.push(line('input', modality, Math.max(0, total - hit), p.input[modality]));
      if (hit) lines.push(line('input', `CACHED_${modality}`, hit, p.cachedInput[modality]));
    }
    const out = count(outDetail[field]);
    if (out !== null) lines.push(line('output', modality, out, p.output[modality]));
  }
  return { kind: 'response', atMs: row.atMs ?? null, promptTokens: count(u.input_tokens), responseTokens: count(u.output_tokens), thoughtsTokens: null, lines, usd: priced(lines) };
}
function transcriptionObservation(row, p) {
  const u = row.value || {}, t = p.transcription;
  const lines = u.type === 'duration' ? [] : [line('input', 'TRANSCRIPTION', count(u.input_tokens), t.input), line('output', 'TRANSCRIPTION', count(u.output_tokens), t.output)];
  return { kind: 'transcription', model: t.model, atMs: row.atMs ?? null, promptTokens: count(u.input_tokens), responseTokens: count(u.output_tokens), thoughtsTokens: null, lines, usd: priced(lines) };
}
// GPT-Live voice is billed for the whole session duration. The final seconds from session.closed win.
// Without them, snapshots lag behind (they arrive every ~15 s), so the larger of the last snapshot and the
// elapsed session time is used and marked as an estimate (elapsed includes connection setup: slightly high).
function gptLiveVoiceObservation(item, p, elapsedSeconds) {
  const rows = (item.usage || []).filter(row => row.source === 'openai-live-voice' && Number.isFinite(row.value?.seconds));
  const final = rows.find(row => row.value.final), last = rows.at(-1);
  const seconds = final ? final.value.seconds : Math.max(last?.value.seconds ?? 0, elapsedSeconds ?? 0) || null;
  const usd = seconds === null ? null : seconds / 60 * p.voicePerMinute;
  return { kind: 'voice', atMs: (final || last)?.atMs ?? null, seconds, assumed: !final, final: Boolean(final), promptTokens: null, responseTokens: null, thoughtsTokens: null, lines: [], usd };
}
// Responses API usage: output_tokens already includes reasoning tokens; cached_tokens is a subset of input.
function gptLiveBackendObservation(row, p) {
  const { model, usage = {} } = row.value || {}, rate = backendRate(model, p);
  const input = count(usage.input_tokens), cached = count(usage.input_tokens_details?.cached_tokens) ?? 0, output = count(usage.output_tokens);
  const lines = rate ? [line('input', 'TEXT', input === null ? null : Math.max(0, input - cached), rate.input), ...(cached ? [line('input', 'CACHED_TEXT', cached, rate.cachedInput)] : []), line('output', 'TEXT', output, rate.output)] : [];
  return { kind: 'backend', model, atMs: row.atMs ?? null, promptTokens: input, responseTokens: output, thoughtsTokens: count(usage.output_tokens_details?.reasoning_tokens), lines, usd: priced(lines) };
}
// Responses may report a dated model id (e.g. gpt-6-luna-2026-…); match it to the configured model.
function backendRate(model, p) {
  const name = Object.keys(p.backend).find(candidate => model === candidate || String(model || '').startsWith(`${candidate}-`));
  return name ? p.backend[name] : null;
}
export function summarizeLive(item) {
  const p = pricingByModel[item.model];
  if (!p || item.mock) return null;
  if (p.provider === 'openai-live') return summarizeGptLive(item, p);
  const observations = (item.usage || []).flatMap(row => {
    if (p.provider === 'google' && row.source === 'google-live') return [geminiObservation(row, p)];
    if (p.provider === 'openai' && row.source === 'openai-realtime') return [openaiObservation(row, p)];
    if (p.provider === 'openai' && row.source === 'openai-transcription') return [transcriptionObservation(row, p)];
    return [];
  });
  const responses = observations.filter(o => o.kind === 'response');
  const total = field => responses.reduce((sum, o) => sum + (o[field] ?? 0), 0);
  const known = observations.filter(o => o.usd !== null);
  const sessionUsd = known.length ? known.reduce((sum, o) => sum + o.usd, 0) : null;
  const modelTurns = countModelTurns(item.events);
  const missingNotices = Math.max(0, modelTurns - responses.length);
  const elapsed = Date.parse(item.endedAt) - Date.parse(item.createdAt);
  return {
    schema: 'live-cost-estimate-v3', pricing: p, fx: fxSnapshot,
    elapsedSeconds: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / 1000 : null,
    recordingSeconds: Number.isFinite(item.recording?.durationMs) ? item.recording.durationMs / 1000 : null,
    observations, tokens: { input: total('promptTokens'), output: total('responseTokens'), thinking: total('thoughtsTokens') },
    sessionUsd, sessionJpy: sessionUsd === null ? null : sessionUsd * fxSnapshot.usdJpy,
    modelTurns, missingNotices, finalUsageConfirmed: responses.length > 0 && missingNotices === 0,
    aggregation: 'sum-of-notices',
    note: 'Estimate from received usage notices, not a bill. A reply cut off by stop or time limit sends no notice, so the true total can be slightly higher.',
  };
}
function summarizeGptLive(item, p) {
  const elapsed = Date.parse(item.endedAt) - Date.parse(item.createdAt);
  const elapsedSeconds = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / 1000 : null;
  const backend = (item.usage || []).filter(row => row.source === 'openai-live-backend').map(row => gptLiveBackendObservation(row, p));
  const observations = [gptLiveVoiceObservation(item, p, elapsedSeconds), ...backend];
  const known = observations.filter(o => o.usd !== null);
  const sessionUsd = known.length ? known.reduce((sum, o) => sum + o.usd, 0) : null;
  const total = field => backend.reduce((sum, o) => sum + (o[field] ?? 0), 0);
  return {
    schema: 'live-cost-estimate-v3', pricing: p, fx: fxSnapshot, elapsedSeconds,
    recordingSeconds: Number.isFinite(item.recording?.durationMs) ? item.recording.durationMs / 1000 : null,
    observations, tokens: { input: total('promptTokens'), output: total('responseTokens'), thinking: total('thoughtsTokens') },
    sessionUsd, sessionJpy: sessionUsd === null ? null : sessionUsd * fxSnapshot.usdJpy,
    modelTurns: countModelTurns(item.events), missingNotices: 0, finalUsageConfirmed: observations[0].final,
    aggregation: 'voice-seconds-plus-backend-tokens',
    note: 'Voice seconds × per-minute rate plus delegated backend tokens. Estimate, not a bill.',
  };
}
