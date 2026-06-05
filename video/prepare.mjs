// Prepares public/ assets for a given episode date.
//
// Usage: node prepare.mjs [YYYY-MM-DD]
//
// It copies the episode audio + timestamp JSON, the host image, the meta.json,
// and any topic images found in articles/{date}/assets/ (topic1.jpg, etc.).
// The image field of each topic in public/meta.json is set to the resolved
// filename when an asset exists, or null otherwise — so the video uses images
// automatically once you drop them into the assets folder.

import {
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const date = process.argv[2] ?? "2026-06-05";
const srcDir = join(repoRoot, "articles", date);
const pub = join(here, "public");
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
// Audio is large; only copy if missing or changed size.
const wavDest = join(pub, "episode.wav");
if (!existsSync(wavDest)) {
  copyFileSync(join(srcDir, wav), wavDest);
}
copyFileSync(join(srcDir, tsJson), join(pub, "episode.json"));

// Host image + program logo (white, transparent).
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
  for (const ext of exts) {
    const candidate = join(assetsDir, `topic${no}.${ext}`);
    if (existsSync(candidate)) {
      const destName = `topic${no}.${ext}`;
      copyFileSync(candidate, join(pub, destName));
      resolved = destName;
      break;
    }
  }
  return { ...topic, image: resolved };
});

writeFileSync(join(pub, "meta.json"), JSON.stringify(meta, null, 2));

console.log(`prepared ${date}`);
console.log(
  `  topic images: ${meta.topics
    .map((t) => `${t.no}:${t.image ?? "—"}`)
    .join("  ")}`,
);
