// Utterance parsing and timing-JSON generation.
//
// Ported from the AI Studio app (gemini-tts-converter/src/App.tsx):
// sentence timestamps are estimated by a character/punctuation weight
// heuristic, then distributed across each section's measured duration.
// Sections may embed [interval: Ns] tags to force silent gaps.

import { splitSentences } from "./split.mjs";

const INTERVAL_RE = /\[interval:\s*(\d+(?:\.\d+)?)\s*s?\]/gi;

export function calcWeight(text) {
  const chars = text.length;
  const commas = (text.match(/[、,]/g) || []).length;
  const ends = (text.match(/[。！？!?]/g) || []).length;
  return chars * 300 + commas * 300 + ends * 600;
}

// Section text -> ordered utterances: {type:'speech', text, weight} | {type:'interval', durationSec}
export function parseUtterances(sectionText) {
  const tokens = [];
  let last = 0;
  let m;
  INTERVAL_RE.lastIndex = 0;
  while ((m = INTERVAL_RE.exec(sectionText)) !== null) {
    if (m.index > last) tokens.push({ type: "text", text: sectionText.slice(last, m.index) });
    tokens.push({ type: "interval", durationSec: Math.max(0.1, parseFloat(m[1])) });
    last = m.index + m[0].length;
  }
  if (last < sectionText.length) tokens.push({ type: "text", text: sectionText.slice(last) });

  const utterances = [];
  for (const token of tokens) {
    if (token.type === "interval") {
      utterances.push({ type: "interval", durationSec: token.durationSec, weight: 0 });
      continue;
    }
    for (const sentence of splitSentences(token.text)) {
      utterances.push({ type: "speech", text: sentence, weight: calcWeight(sentence) });
    }
  }
  return utterances;
}

// Text sent to the TTS model: speech only, interval tags stripped.
export function speechText(sectionText) {
  return parseUtterances(sectionText)
    .filter((u) => u.type === "speech")
    .map((u) => u.text)
    .join("\n");
}

// Build the flat timing list [{id, start_ms, text}] that video/prepare.mjs
// consumes. IDs follow the s{section}_{sentence} convention so captions
// group correctly.
export function buildTimingJson(sections, sectionStartsMs, sectionDurationsMs) {
  const out = [];
  sections.forEach((text, i) => {
    const utterances = parseUtterances(text);
    const speech = utterances.filter((u) => u.type === "speech");
    const totalWeight = speech.reduce((sum, u) => sum + u.weight, 0);
    const intervalMs = utterances
      .filter((u) => u.type === "interval")
      .reduce((sum, u) => sum + Math.round(u.durationSec * 1000), 0);
    const speechMs = Math.max(0, sectionDurationsMs[i] - intervalMs);

    let offsetMs = 0;
    let sentenceNo = 0;
    for (const u of utterances) {
      if (u.type === "interval") {
        offsetMs += Math.round(u.durationSec * 1000);
        continue;
      }
      sentenceNo += 1;
      out.push({
        id: `s${i + 1}_${sentenceNo}`,
        start_ms: sectionStartsMs[i] + offsetMs,
        text: u.text,
      });
      const fraction = totalWeight > 0 ? u.weight / totalWeight : 0;
      offsetMs += Math.round(speechMs * fraction);
    }
  });
  return out;
}
