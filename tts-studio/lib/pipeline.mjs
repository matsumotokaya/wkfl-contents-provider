// Episode pipeline shared by the CLI and the tuning Web UI:
// script markdown -> sections -> TTS -> interval injection -> BGM mix
// -> episode.wav + episode.json (+ meta.json stub) in articles/{date}/.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

import { splitScript } from "./split.mjs";
import { parseUtterances, speechText, buildTimingJson } from "./timing.mjs";
import { synthesizeSection } from "./tts.mjs";
import {
  int16ToF32,
  injectIntervals,
  decodeAudioFile,
  mixEpisode,
  encodeWav16,
} from "./audio.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const STUDIO_ROOT = join(here, "..");
export const REPO_ROOT = join(STUDIO_ROOT, "..");
export const ARTICLES_DIR = join(REPO_ROOT, "articles");

// .env: tts-studio/.env first, repo root .env as fallback.
loadDotenv({ path: join(STUDIO_ROOT, ".env") });
loadDotenv({ path: join(REPO_ROOT, ".env") });

export function loadConfig() {
  return JSON.parse(readFileSync(join(STUDIO_ROOT, "config.json"), "utf8"));
}

// "acoustic" (preset key) | "/abs/path.mp3" | "none"/null -> abs path or null
export function resolveBgmPath(config, bgm) {
  if (!bgm || bgm === "none") return null;
  const preset = config.bgm[bgm];
  const path = preset ?? bgm;
  const abs = isAbsolute(path) ? path : resolve(STUDIO_ROOT, path);
  if (!existsSync(abs)) throw new Error(`BGM file not found: ${abs}`);
  return abs;
}

// "news" (preset key) | free text | "" (no persona)
export function resolvePersona(config, persona) {
  if (persona == null) return config.personas[config.defaults.persona] ?? "";
  return config.personas[persona] ?? persona;
}

// Locate the podcast script for a date. Prefers articles_podcast.md,
// falls back to any *_podcast.md (newest wins if several).
export function findPodcastScript(date) {
  const dir = join(ARTICLES_DIR, date);
  if (!existsSync(dir)) throw new Error(`No articles directory for ${date}: ${dir}`);
  const candidates = readdirSync(dir).filter((f) => f.endsWith("_podcast.md"));
  if (candidates.length === 0) throw new Error(`No *_podcast.md found in ${dir}`);
  const preferred = candidates.includes("articles_podcast.md")
    ? "articles_podcast.md"
    : candidates.sort().at(-1);
  return { dir, file: preferred, path: join(dir, preferred), candidates };
}

// Core generation. sections: string[] (already split / hand-tuned).
// Returns { wavBuffer, timing, totalMs, sectionStartsMs, sectionDurationsMs }.
export async function generateEpisode({ sections, voice, persona, bgm, config, onProgress = () => {} }) {
  const cfg = config ?? loadConfig();
  const apiKey = process.env.GEMINI_API_KEY;
  const model = cfg.model;
  const personaText = resolvePersona(cfg, persona);
  const voiceId = voice ?? cfg.defaults.voice;

  // 1. Synthesize each section, then inject [interval] silences.
  const speechSections = [];
  for (let i = 0; i < sections.length; i++) {
    const text = sections[i];
    onProgress({ stage: "tts", index: i, total: sections.length });
    const clean = speechText(text);
    const { pcm, sampleRate } = await synthesizeSection({
      text: clean,
      voice: voiceId,
      persona: personaText,
      model,
      provider: cfg.provider,
      apiKey,
    });
    const utterances = parseUtterances(text);
    const f32 = injectIntervals(int16ToF32(pcm), sampleRate, utterances);
    speechSections.push({ f32, sampleRate });
  }

  // 2. Decode BGM (any format ffmpeg understands) and mix.
  onProgress({ stage: "mix" });
  const bgmPath = resolveBgmPath(cfg, bgm ?? cfg.defaults.bgm);
  const bgmAudio = bgmPath ? decodeAudioFile(bgmPath, cfg.mix.sampleRate) : null;
  const mixed = mixEpisode(speechSections, bgmAudio, cfg.mix);

  // 3. Encode WAV + timing JSON.
  onProgress({ stage: "encode" });
  const wavBuffer = encodeWav16([mixed.L, mixed.R], cfg.mix.sampleRate);
  const timing = buildTimingJson(sections, mixed.sectionStartsMs, mixed.sectionDurationsMs);

  return {
    wavBuffer,
    timing,
    totalMs: mixed.totalMs,
    sectionStartsMs: mixed.sectionStartsMs,
    sectionDurationsMs: mixed.sectionDurationsMs,
  };
}

// Write episode.wav / episode.json into articles/{date}/ and create a
// meta.json stub when missing (topics stay manual — they are editorial).
export function saveEpisode({ date, title, wavBuffer, timing }) {
  const dir = join(ARTICLES_DIR, date);
  if (!existsSync(dir)) throw new Error(`No articles directory for ${date}: ${dir}`);

  const wavPath = join(dir, "episode.wav");
  const jsonPath = join(dir, "episode.json");
  writeFileSync(wavPath, wavBuffer);
  writeFileSync(jsonPath, JSON.stringify(timing, null, 2));

  const metaPath = join(dir, "meta.json");
  let metaCreated = false;
  if (!existsSync(metaPath)) {
    const stub = {
      program: "WKFLのAI TODAY",
      title: title ?? "",
      date,
      links: { note: "note.com/wkflstudio", x: "x.com/wkflstudio", spotify: "WKFL" },
      topics: [],
    };
    writeFileSync(metaPath, JSON.stringify(stub, null, 2));
    metaCreated = true;
  }

  // prepare.mjs grabs the first *.wav / non-meta *.json it finds — warn if
  // stale outputs from the old browser app could shadow the new files.
  const others = readdirSync(dir).filter(
    (f) =>
      (f.endsWith(".wav") || f.endsWith(".json")) &&
      !["episode.wav", "episode.json", "meta.json"].includes(f),
  );

  return { wavPath, jsonPath, metaPath, metaCreated, conflictingFiles: others };
}

export { splitScript };
