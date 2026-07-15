// Tuning Web UI for the WKFL TTS pipeline.
//
//   npm run ui   ->  http://localhost:8787
//
// The API key stays server-side (.env); the browser never sees it.

import express from "express";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  STUDIO_ROOT,
  ARTICLES_DIR,
  loadConfig,
  splitScript,
  generateEpisode,
  saveEpisode,
} from "./lib/pipeline.mjs";
import { speechText } from "./lib/timing.mjs";
import { synthesizeSection } from "./lib/tts.mjs";
import { resolvePersona } from "./lib/pipeline.mjs";
import { encodeWav16, int16ToF32 } from "./lib/audio.mjs";

const PORT = process.env.PORT ?? 8787;
const OUT_DIR = join(STUDIO_ROOT, "out");
mkdirSync(OUT_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(STUDIO_ROOT, "public")));
app.use("/out", express.static(OUT_DIR));

// ---- config & presets ----
app.get("/api/config", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    model: cfg.model,
    defaults: cfg.defaults,
    voices: cfg.voices,
    personas: cfg.personas,
    bgm: Object.keys(cfg.bgm),
    mock: process.env.WKFL_TTS_MOCK === "1",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// ---- episode scripts ----
app.get("/api/dates", (_req, res) => {
  const dates = readdirSync(ARTICLES_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()
    .map((date) => {
      const files = readdirSync(join(ARTICLES_DIR, date)).filter((f) => f.endsWith("_podcast.md"));
      return { date, files };
    })
    .filter((d) => d.files.length > 0);
  res.json(dates);
});

app.get("/api/script", (req, res) => {
  const { date, file } = req.query;
  const path = join(ARTICLES_DIR, String(date), String(file));
  if (!path.startsWith(ARTICLES_DIR) || !existsSync(path)) {
    return res.status(404).json({ error: "script not found" });
  }
  res.json({ content: readFileSync(path, "utf8") });
});

// ---- split ----
app.post("/api/split", (req, res) => {
  const cfg = loadConfig();
  const { title, sections } = splitScript(req.body.text ?? "", cfg.split.maxSectionChars);
  res.json({ title, sections });
});

// ---- per-section preview (returns a small wav) ----
app.post("/api/preview", async (req, res) => {
  try {
    const cfg = loadConfig();
    const { text, voice, persona } = req.body;
    const { pcm, sampleRate } = await synthesizeSection({
      text: speechText(text ?? ""),
      voice: voice ?? cfg.defaults.voice,
      persona: resolvePersona(cfg, persona),
      model: cfg.model,
      provider: cfg.provider,
      apiKey: process.env.GEMINI_API_KEY,
    });
    const wav = encodeWav16([int16ToF32(pcm)], sampleRate);
    res.set("Content-Type", "audio/wav").send(wav);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- full render (optionally save into articles/{date}/) ----
app.post("/api/render", async (req, res) => {
  try {
    const cfg = loadConfig();
    const { sections, voice, persona, bgm, date, title, save } = req.body;
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ error: "sections is empty" });
    }

    const progress = [];
    const result = await generateEpisode({
      sections,
      voice,
      persona,
      bgm,
      config: cfg,
      onProgress: (p) => progress.push(p),
    });

    // Always keep a preview copy the browser can stream.
    const previewName = `render-${Date.now()}.wav`;
    writeFileSync(join(OUT_DIR, previewName), result.wavBuffer);

    let saved = null;
    if (save && date) {
      saved = saveEpisode({ date, title, wavBuffer: result.wavBuffer, timing: result.timing });
    }

    res.json({
      url: `/out/${previewName}`,
      totalMs: result.totalMs,
      timing: result.timing,
      sectionStartsMs: result.sectionStartsMs,
      saved: saved && {
        wavPath: saved.wavPath,
        jsonPath: saved.jsonPath,
        metaCreated: saved.metaCreated,
        conflictingFiles: saved.conflictingFiles,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`WKFL TTS Studio UI: http://localhost:${PORT}`);
  if (process.env.WKFL_TTS_MOCK === "1") console.log("MODE: MOCK (no API calls)");
  else if (!process.env.GEMINI_API_KEY) console.log("NOTE: GEMINI_API_KEY not set — generation will fail until you add it to .env");
});
