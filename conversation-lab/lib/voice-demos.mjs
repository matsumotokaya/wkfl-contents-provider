import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { catalog, sampleText } from './catalog.mjs';

// Japanese catalog demos: the same text and delivery instruction for every voice of a set, so voices compare fairly.
// One set per provider. Prices are the Standard paid tier (2026-10-11), used only for the dry-run upper bound.
const condition = '自然な日本語で、明瞭に読み上げる。';
export const demoSets = {
  google: {
    id: 'google', language: 'ja', model: 'gemini-3.8-flash-tts', text: sampleText, condition, voices: catalog.tts.voices, dirName: 'ja',
    pricing: { checkedAt: '2026-10-11', source: 'https://ai.google.dev/gemini-api/docs/pricing', inputTextUsdPerM: 0.5, outputAudioUsdPerM: 9, audioTokensPerSecond: 25 },
  },
  // Read by the Realtime model itself, so the demo sounds like a Realtime conversation (TTS models differ).
  openai: {
    id: 'openai', language: 'ja', model: 'gpt-realtime-2.1', text: sampleText, condition, voices: catalog.live.voicesByProvider.openai, dirName: 'openai-ja',
    pricing: { checkedAt: '2026-10-11', source: 'https://developers.openai.com/api/docs/pricing', inputTextUsdPerM: 4, outputAudioUsdPerM: 64, audioTokensPerSecond: 20 },
  },
};
const settingsOf = set => ({ language: set.language, model: set.model, text: set.text, condition: set.condition });
export const demoSettings = settingsOf(demoSets.google);
export const demoPricing = demoSets.google.pricing;
export const publicDemoSettings = set => settingsOf(set);
export function estimateDemoUsd(count, { set = demoSets.google, seconds = 20, inputTokens = 200 } = {}) {
  const p = set.pricing;
  return count * (seconds * p.audioTokensPerSecond * p.outputAudioUsdPerM + inputTokens * p.inputTextUsdPerM) / 1e6;
}
// Spaces and punctuation are ignored when checking that a model read the text verbatim.
const normalize = text => String(text).replace(/[\s、。，．,.!?！？「」]/g, '');
export const demoPaths = (dir, voice) => ({ wav: join(dir, `${voice}.wav`), json: join(dir, `${voice}.json`) });
// A demo counts only when it was made with the current model, text and instruction; older ones are 'stale'.
export function demoStatus(dir, voice, set = demoSets.google) {
  const paths = demoPaths(dir, voice);
  if (!existsSync(paths.wav) || !existsSync(paths.json)) return { state: 'missing' };
  try {
    const meta = JSON.parse(readFileSync(paths.json, 'utf8'));
    const current = meta.model === set.model && meta.text === set.text && meta.condition === set.condition;
    return { state: current ? 'current' : 'stale', meta };
  } catch { return { state: 'stale', meta: null }; }
}
export function readDemos(dir, set = demoSets.google) {
  const demos = {};
  for (const voice of set.voices) {
    const { state, meta } = demoStatus(dir, voice, set);
    if (state === 'current') demos[voice] = { model: meta.model, createdAt: meta.createdAt, audioSeconds: meta.audioSeconds, transcriptMatches: meta.transcriptMatches ?? null };
  }
  return demos;
}
// Keep superseded demos instead of deleting them: they were paid for.
function supersede(dir, voice, meta) {
  const paths = demoPaths(dir, voice), archive = join(dir, 'superseded');
  mkdirSync(archive, { recursive: true, mode: 0o700 });
  const stamp = (meta?.createdAt || new Date().toISOString()).replace(/[:.]/g, '-');
  renameSync(paths.wav, join(archive, `${voice}-${stamp}.wav`));
  renameSync(paths.json, join(archive, `${voice}-${stamp}.json`));
}
export function wavSeconds(bytes) {
  // Read the data chunk size: Gemini TTS files can carry trailing bytes after it, so file length overstates duration.
  const byteRate = bytes.readUInt32LE(28);
  for (let offset = 12; byteRate && offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    if (id === 'data') return Math.round((size / byteRate) * 1000) / 1000;
    offset += 8 + size + (size % 2);
  }
  return null;
}
function write(path, data) { writeFileSync(path + '.tmp', data, { mode: 0o600 }); renameSync(path + '.tmp', path); }
// Sequential, no retry: the first failure stops the run. Voices with a current demo are skipped, so re-running never pays twice.
export async function generateDemos({ voices, dir, synthesize, key, set = demoSets.google, log = () => {}, timeoutMs = 90000, intervalMs = 0 }) {
  for (const voice of voices) if (!set.voices.includes(voice)) throw new Error(`Unknown voice: ${voice}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const done = [], skipped = [];
  let called = false;
  for (const voice of voices) {
    const paths = demoPaths(dir, voice), status = demoStatus(dir, voice, set);
    if (status.state === 'current') { skipped.push(voice); log(`${voice}: 既存のためスキップ`); continue; }
    const settings = { provider: set.id, model: set.model, voice, text: set.text, condition: set.condition };
    // Spacing between calls keeps under per-minute quotas; it is not a retry.
    if (called && intervalMs) await new Promise(resolve => setTimeout(resolve, intervalMs));
    called = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs), begin = performance.now();
    try {
      const result = await synthesize(settings, { key, mock: false, signal: controller.signal });
      const meta = { ...settings, language: set.language, createdAt: new Date().toISOString(), audioSeconds: wavSeconds(result.audio), requestToCompleteMs: Math.round(performance.now() - begin), usage: result.usage ?? null };
      if (typeof result.transcript === 'string') { meta.transcript = result.transcript; meta.transcriptMatches = normalize(result.transcript) === normalize(set.text); }
      if (status.state === 'stale') supersede(dir, voice, status.meta);
      write(paths.wav, result.audio);
      write(paths.json, JSON.stringify(meta, null, 2));
      done.push(voice); log(`${voice}: 保存 (${meta.audioSeconds}秒${meta.transcriptMatches === false ? '・文字起こしが原文と不一致' : ''})`);
    } catch (error) {
      // Local diagnosis only (data/ is outside Git); the body is already redacted by the provider adapter.
      if (error.providerBody) write(join(dir, 'last-error.json'), JSON.stringify({ voice, at: new Date().toISOString(), message: error.message, body: error.providerBody }, null, 2));
      log(`${voice}: 失敗のため停止 (${controller.signal.aborted ? 'timeout' : error.message})`);
      return { done, skipped, failed: voice };
    } finally { clearTimeout(timer); }
  }
  return { done, skipped, failed: null };
}
