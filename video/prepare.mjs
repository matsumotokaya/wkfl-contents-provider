// Prepares a per-episode public directory for Remotion.
//
// Usage: node prepare.mjs [YYYY-MM-DD]
//
// Output: video/public/{date}/  (one directory per episode, nothing shared)
//
// Launch Studio:  npx remotion studio --public-dir public/{date} --port 3001
// Render:         npx remotion render WKFL out/WKFL-{date}.mp4 --public-dir public/{date}

import {
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Read WAV header to compute duration in milliseconds.
function getWavDurationMs(wavPath) {
  const buf = Buffer.alloc(256);
  const fd = openSync(wavPath, "r");
  readSync(fd, buf, 0, 256, 0);
  closeSync(fd);
  const sampleRate = buf.readUInt32LE(24);
  const numChannels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      return Math.round(
        (chunkSize / (sampleRate * numChannels * (bitsPerSample / 8))) * 1000,
      );
    }
    offset += 8 + chunkSize;
  }
  throw new Error("No data chunk found in WAV file: " + wavPath);
}

// Convert new flat-list format [{id,start_ms,text}] to the Episode object
// that captions.ts expects: {total_duration_ms, segments:[{id,type,text,start_ms,end_ms}]}.
function convertFlatList(sentences, totalDurationMs) {
  const groups = new Map();
  for (const s of sentences) {
    const m = s.id.match(/^s(\d+)_/);
    const no = m ? parseInt(m[1], 10) : 0;
    if (!groups.has(no)) groups.set(no, []);
    groups.get(no).push(s);
  }
  const segNos = [...groups.keys()].sort((a, b) => a - b);
  const segments = segNos.map((no, i) => {
    const items = groups.get(no);
    const nextNo = segNos[i + 1];
    const nextItems = nextNo != null ? groups.get(nextNo) : null;
    return {
      id: `segment_${no}`,
      type: "normal",
      text: items.map((s) => s.text).join(""),
      start_ms: items[0].start_ms,
      end_ms: nextItems ? nextItems[0].start_ms : totalDurationMs,
    };
  });
  return { total_duration_ms: totalDurationMs, segments };
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const srcDir = join(repoRoot, "articles", date);
const pub = join(here, "public", date);   // per-episode directory
const exts = ["jpg", "jpeg", "png", "webp"];

mkdirSync(pub, { recursive: true });

// Audio + timestamp JSON (the WKFL TTS app emits a radio-show-*.wav/.json pair).
const files = readdirSync(srcDir);
const wav = files.find((f) => f.toLowerCase().endsWith(".wav"));
const tsJson = files.find(
  (f) => f.toLowerCase().endsWith(".json") && f !== "meta.json",
);
if (!wav || !tsJson) {
  throw new Error(`Missing .wav or timestamp .json in ${srcDir}`);
}

// Audio: copy if missing in the episode directory (safe to skip on re-runs).
const wavDest = join(pub, "episode.wav");
if (!existsSync(wavDest)) {
  console.log(`  copying wav (may take a moment)...`);
  copyFileSync(join(srcDir, wav), wavDest);
} else {
  console.log(`  wav already present, skipping copy`);
}

// Parse the timestamp JSON and normalise to Episode format if needed.
const rawJson = JSON.parse(readFileSync(join(srcDir, tsJson), "utf8"));
let episodeData;
if (Array.isArray(rawJson)) {
  const durationMs = getWavDurationMs(join(srcDir, wav));
  console.log(`  wav duration: ${durationMs}ms`);
  episodeData = convertFlatList(rawJson, durationMs);
} else {
  episodeData = rawJson;
}
writeFileSync(join(pub, "episode.json"), JSON.stringify(episodeData, null, 2));

// Host image + program logo.
copyFileSync(
  join(repoRoot, "brand", "Japanese_man_wearing_202604202213.jpeg"),
  join(pub, "host.jpeg"),
);
copyFileSync(
  join(repoRoot, "brand", "logo_wkfl_white_001.png"),
  join(pub, "logo.png"),
);

// Meta + topic images.
const meta = JSON.parse(readFileSync(join(srcDir, "meta.json"), "utf8"));
const assetsDir = join(srcDir, "assets");

meta.topics = meta.topics.map((topic, i) => {
  const no = topic.no ?? i + 1;
  let resolved = null;
  // Look for: assets/topicN.ext  OR  {srcDir}/NNN.ext (001, 002, ...)
  const candidates = [
    ...exts.map((ext) => ({ path: join(assetsDir, `topic${no}.${ext}`), ext })),
    ...exts.map((ext) => ({ path: join(srcDir, `${String(no).padStart(3, "0")}.${ext}`), ext })),
  ];
  for (const { path, ext } of candidates) {
    if (existsSync(path)) {
      const destName = `topic${no}.${ext}`;
      copyFileSync(path, join(pub, destName));
      resolved = destName;
      break;
    }
  }
  return { ...topic, image: resolved };
});

writeFileSync(join(pub, "meta.json"), JSON.stringify(meta, null, 2));

console.log(`prepared ${date} → public/${date}/`);
console.log(
  `  topic images: ${meta.topics
    .map((t) => `${t.no}:${t.image ?? "—"}`)
    .join("  ")}`,
);
console.log();
console.log(`Next steps:`);
console.log(`  Studio:  npx remotion studio --public-dir public/${date} --port 3001`);
console.log(`  Render:  npx remotion render WKFL out/WKFL-${date}.mp4 --public-dir public/${date}`);
