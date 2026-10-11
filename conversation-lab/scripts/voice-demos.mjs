// Generates Japanese catalog demos with Gemini TTS.
// Default is a dry run (no key read, no API call). --execute calls the paid API.
//   node scripts/voice-demos.mjs                     plan for all missing voices
//   node scripts/voice-demos.mjs --voices Kore       plan for one voice
//   node scripts/voice-demos.mjs --voices Kore --execute
//   node scripts/voice-demos.mjs --execute --interval 20   wait 20 s between calls (per-minute quota)
//   node scripts/voice-demos.mjs --provider openai --execute   OpenAI voices read by gpt-realtime-2.1
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize } from '../lib/google.mjs';
import { speakRealtime } from '../lib/openai.mjs';
import { loadGoogleKey, loadOpenAIKey } from '../lib/credentials.mjs';
import { demoSets, demoStatus, estimateDemoUsd, generateDemos } from '../lib/voice-demos.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const providerName = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : 'google';
const set = demoSets[providerName];
if (!set) { console.error('--provider must be google or openai'); process.exit(1); }
const dir = join(root, 'data', 'voice-demos', set.dirName);
const execute = args.includes('--execute');
const listed = args.includes('--voices') ? (args[args.indexOf('--voices') + 1] || '').split(',').filter(Boolean) : set.voices;
const unknown = listed.filter(v => !set.voices.includes(v));
if (unknown.length) { console.error(`Unknown voice: ${unknown.join(', ')}`); process.exit(1); }
const intervalSeconds = args.includes('--interval') ? Number(args[args.indexOf('--interval') + 1]) : 0;
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0 || intervalSeconds > 600) { console.error('--interval must be 0–600 seconds'); process.exit(1); }
const missing = listed.filter(v => demoStatus(dir, v, set).state !== 'current');
const stale = missing.filter(v => demoStatus(dir, v, set).state === 'stale');

console.log(`モデル: ${set.model}`);
console.log(`文: ${set.text}`);
console.log(`読み方の指示: ${set.condition}`);
console.log(`保存先: ${dir}`);
console.log(`生成対象 ${missing.length}件 / 既存スキップ ${listed.length - missing.length}件: ${missing.join(', ') || 'なし'}`);
if (stale.length) console.log(`作り直し（旧版は superseded/ へ移動）: ${stale.join(', ')}`);
console.log(`概算上限: $${estimateDemoUsd(missing.length, { set }).toFixed(4)}（1件20秒・入力200 tokensと仮定。${set.pricing.checkedAt}確認の標準料金。税は未考慮）`);
if (!execute) { console.log('DRY RUN: APIは呼んでいません。実行は --execute。'); process.exit(0); }
if (!missing.length) process.exit(0);

const key = providerName === 'openai' ? loadOpenAIKey() : loadGoogleKey({ repoRoot: join(root, '..') });
const result = await generateDemos({ voices: missing, dir, set, synthesize: providerName === 'openai' ? speakRealtime : synthesize, key, intervalMs: intervalSeconds * 1000, log: line => console.log(line) });
console.log(`完了 ${result.done.length}件 / スキップ ${result.skipped.length}件${result.failed ? ` / ${result.failed}で停止（自動再試行なし）` : ''}`);
process.exit(result.failed ? 1 : 0);
