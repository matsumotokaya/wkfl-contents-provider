export const livePricing = Object.freeze({
  model: 'gemini-3.8-live', checkedAt: '2026-10-11', currency: 'USD', unit: '1M tokens',
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  usageSource: 'https://ai.google.dev/api/live',
  input: { TEXT: 0.75, AUDIO: 3, IMAGE: 1, VIDEO: 1 }, output: { TEXT: 4.5, AUDIO: 12 }
});
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function summarizeLive(item) {
  if (item.model !== livePricing.model || item.mock) return null;
  const observations = (item.usage || []).filter(row => row.source === 'google-live').map(row => {
    const value = row.value || {}, lines = [];
    for (const [direction, field] of [['input','promptTokensDetails'], ['output','responseTokensDetails']]) {
      for (const detail of value[field] || []) {
        const tokens = count(detail.tokenCount), rate = livePricing[direction][detail.modality];
        lines.push({ direction, modality: detail.modality, tokens, rate: rate ?? null, usd: tokens !== null && rate !== undefined ? tokens * rate / 1e6 : null });
      }
    }
    const residual = (direction, total) => {
      const subset = lines.filter(line => line.direction === direction);
      return count(total) !== null && subset.length && subset.every(line => line.tokens !== null) ? total - subset.reduce((sum,line) => sum + line.tokens, 0) : null;
    };
    return { atMs: row.atMs ?? null, promptTokens: count(value.promptTokenCount), responseTokens: count(value.responseTokenCount), thoughtsTokens: count(value.thoughtsTokenCount), inputUnclassified: residual('input', value.promptTokenCount), outputUnclassified: residual('output', value.responseTokenCount), lines, knownDetailsUsd: lines.some(line => line.usd !== null) ? lines.reduce((sum,line) => sum + (line.usd ?? 0), 0) : null };
  });
  const elapsed = Date.parse(item.endedAt) - Date.parse(item.createdAt);
  return { schema: 'live-cost-observations-v1', pricing: livePricing, elapsedSeconds: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / 1000 : null, recordingSeconds: Number.isFinite(item.recording?.durationMs) ? item.recording.durationMs / 1000 : null, observations, sessionUsd: null, finalUsageConfirmed: false, aggregation: 'none', reason: 'Usage notification scope and final completeness are unverified. Observations are not added. Unclassified and thinking tokens are not priced twice or assigned an inferred modality. Elapsed time is not billed audio time.' };
}
