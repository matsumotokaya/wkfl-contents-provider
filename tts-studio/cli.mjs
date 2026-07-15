#!/usr/bin/env node
// WKFL TTS pipeline CLI: podcast script -> episode.wav + episode.json.
//
// Usage:
//   node cli.mjs 2026-07-13                       # find articles/{date}/*_podcast.md
//   node cli.mjs articles/2026-07-13/freetalk_podcast.md
//   node cli.mjs 2026-07-13 --voice Kore --persona critic --bgm none
//
// Options:
//   --voice <id>       Charon | Kore | Puck | Fenrir | Zephyr | Aoede
//   --persona <key|text>  news | critic | youtuber | free text | "" (none)
//   --bgm <key|path|none>  acoustic | fashion | kawaii | /path/to/file | none
//   --dry-run          split only; show sections and exit
//
// Env: GEMINI_API_KEY (tts-studio/.env or repo root .env)
//      WKFL_TTS_MOCK=1  placeholder audio, no API calls (pipeline testing)

import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  loadConfig,
  findPodcastScript,
  splitScript,
  generateEpisode,
  saveEpisode,
} from "./lib/pipeline.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (!target) {
  console.error("Usage: node cli.mjs <YYYY-MM-DD | path/to/script.md> [--voice ...] [--persona ...] [--bgm ...] [--dry-run]");
  process.exit(1);
}

const config = loadConfig();

// Resolve script path + date.
let scriptPath;
let date;
if (/^\d{4}-\d{2}-\d{2}$/.test(target)) {
  date = target;
  const found = findPodcastScript(date);
  scriptPath = found.path;
  if (found.candidates.length > 1) {
    console.log(`* Multiple podcast scripts in ${date}: ${found.candidates.join(", ")}`);
    console.log(`  -> using ${found.file}`);
  }
} else {
  scriptPath = resolve(target);
  const m = scriptPath.match(/(\d{4}-\d{2}-\d{2})/);
  date = m ? m[1] : new Date().toISOString().slice(0, 10);
}

const markdown = readFileSync(scriptPath, "utf8");
const { title, sections } = splitScript(markdown, config.split.maxSectionChars);

console.log(`Script : ${basename(dirname(scriptPath))}/${basename(scriptPath)}`);
console.log(`Title  : ${title ?? "(no H1 title)"}`);
console.log(`Split  : ${sections.length} sections (${sections.map((s) => s.length).join(" / ")} chars)`);

if (args.dryRun) {
  sections.forEach((s, i) => {
    console.log(`\n--- s${i + 1} (${s.length} chars) ---\n${s.slice(0, 120)}${s.length > 120 ? "…" : ""}`);
  });
  process.exit(0);
}

const voice = args.voice ?? config.defaults.voice;
const persona = args.persona; // resolved inside pipeline (undefined -> default)
const bgm = args.bgm ?? config.defaults.bgm;
console.log(`Voice  : ${voice}   Persona: ${persona ?? config.defaults.persona}   BGM: ${bgm}`);
if (process.env.WKFL_TTS_MOCK === "1") console.log("MODE   : MOCK (no API calls, placeholder audio)");

const startedAt = Date.now();
const result = await generateEpisode({
  sections,
  voice,
  persona,
  bgm,
  config,
  onProgress: ({ stage, index, total }) => {
    if (stage === "tts") console.log(`  [${index + 1}/${total}] synthesizing…`);
    else console.log(`  ${stage}…`);
  },
});

const saved = saveEpisode({ date, title, wavBuffer: result.wavBuffer, timing: result.timing });

console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
console.log(`  audio : ${saved.wavPath}  (${(result.totalMs / 1000).toFixed(1)}s)`);
console.log(`  timing: ${saved.jsonPath}  (${result.timing.length} entries)`);
if (saved.metaCreated) console.log(`  meta  : ${saved.metaPath}  (stub created — fill in topics for the video)`);
if (saved.conflictingFiles.length > 0) {
  console.log(`\n! WARNING: other .wav/.json files exist in articles/${date}/ — video/prepare.mjs picks the first match.`);
  console.log(`  Remove stale files if needed: ${saved.conflictingFiles.join(", ")}`);
}
console.log(`\nNext: cd video && node prepare.mjs ${date}`);
