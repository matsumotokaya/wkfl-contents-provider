// PCM utilities: decode, resample, interval injection, BGM mix, WAV encode.
// The mixing behaviour (intro/outro delays, ducking envelope, fades) is a
// straight port of the AI Studio app's OfflineAudioContext scheduling.

import { spawnSync } from "node:child_process";

// ---------- basic conversions ----------

export function int16ToF32(int16) {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

export function bufferToInt16(buf) {
  // Copy to guarantee 2-byte alignment.
  const even = buf.length - (buf.length % 2);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + even);
  return new Int16Array(ab);
}

export function resampleLinear(f32, fromRate, toRate) {
  if (fromRate === toRate) return f32;
  const outLength = Math.round((f32.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, f32.length - 1);
    const frac = pos - i0;
    out[i] = f32[i0] * (1 - frac) + f32[i1] * frac;
  }
  return out;
}

// ---------- external decode (BGM: mp3/wav/anything ffmpeg reads) ----------

export function decodeAudioFile(path, sampleRate) {
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", String(sampleRate), "-"],
    { maxBuffer: 1 << 30 },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed to decode ${path}: ${r.stderr?.toString().slice(0, 500)}`);
  }
  const buf = r.stdout;
  const frames = Math.floor(buf.length / 8); // 2ch * f32
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + frames * 8);
  const interleaved = new Float32Array(ab);
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    L[i] = interleaved[i * 2];
    R[i] = interleaved[i * 2 + 1];
  }
  return { L, R, sampleRate };
}

// ---------- interval injection ----------

// Insert silence into a section's audio according to [interval] utterances,
// distributing the original samples across speech utterances by weight.
export function injectIntervals(f32, sampleRate, utterances) {
  const intervals = utterances.filter((u) => u.type === "interval");
  if (intervals.length === 0) return f32;
  const speech = utterances.filter((u) => u.type === "speech");
  if (speech.length === 0) return f32;

  const totalWeight = speech.reduce((sum, u) => sum + u.weight, 0);
  const intervalSamples = intervals.reduce(
    (sum, u) => sum + Math.round(u.durationSec * sampleRate),
    0,
  );
  const out = new Float32Array(f32.length + intervalSamples);

  let src = 0;
  let dst = 0;
  let speechIdx = 0;
  for (const u of utterances) {
    if (u.type === "speech") {
      let n =
        speechIdx === speech.length - 1
          ? f32.length - src
          : Math.round(f32.length * (totalWeight > 0 ? u.weight / totalWeight : 0));
      n = Math.min(n, f32.length - src);
      if (n > 0) {
        out.set(f32.subarray(src, src + n), dst);
        src += n;
        dst += n;
      }
      speechIdx += 1;
    } else {
      dst += Math.round(u.durationSec * sampleRate);
    }
  }
  return out;
}

// ---------- mixing ----------

function envelopeAt(points, t) {
  // points: [[timeSec, gain], ...] sorted by time; linear interpolation.
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const [t0, g0] = points[i - 1];
      const [t1, g1] = points[i];
      if (t1 === t0) return g1;
      return g0 + ((g1 - g0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

// speechSections: [{f32, sampleRate}] mono, already interval-injected.
// bgm: {L, R} at opts.sampleRate, or null.
// Returns {L, R, sectionStartsMs, sectionDurationsMs, totalMs}.
export function mixEpisode(speechSections, bgm, opts) {
  const SR = opts.sampleRate;
  const speech = speechSections.map((s) =>
    s.sampleRate === SR ? s.f32 : resampleLinear(s.f32, s.sampleRate, SR),
  );

  const introDelay = bgm ? opts.introDelaySec : 0;
  const outroDelay = bgm ? opts.outroDelaySec : 0.5;
  const gap = opts.sectionGapSec;

  const starts = [];
  let t = introDelay;
  for (const s of speech) {
    starts.push(t);
    t += s.length / SR + gap;
  }
  const lastSpeechEnd = t - gap;
  const totalSec = lastSpeechEnd + outroDelay;
  const N = Math.ceil(totalSec * SR);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  speech.forEach((s, i) => {
    const off = Math.round(starts[i] * SR);
    for (let j = 0; j < s.length && off + j < N; j++) {
      L[off + j] += s[j];
      R[off + j] += s[j];
    }
  });

  if (bgm) {
    const maxGain = opts.bgmVolume * opts.bgmMaxRatio;
    const duckGain = opts.bgmVolume * opts.duckRatio;
    const points = [
      [0, maxGain],
      [Math.max(0, starts[0] - 0.5), duckGain],
      [lastSpeechEnd, duckGain],
      [lastSpeechEnd + 0.5, maxGain],
      [Math.max(lastSpeechEnd + 0.5, totalSec - opts.fadeOutSec), maxGain],
      [totalSec, 0],
    ];
    const bgmLen = bgm.L.length;
    for (let i = 0; i < N; i++) {
      const g = envelopeAt(points, i / SR);
      const bi = i % bgmLen; // loop the BGM
      L[i] += bgm.L[bi] * g;
      R[i] += bgm.R[bi] * g;
    }
  }

  return {
    L,
    R,
    sectionStartsMs: starts.map((s) => Math.round(s * 1000)),
    sectionDurationsMs: speech.map((s) => Math.round((s.length / SR) * 1000)),
    totalMs: Math.round(totalSec * 1000),
  };
}

// ---------- WAV encode ----------

export function encodeWav16(channels, sampleRate) {
  const numCh = channels.length;
  const frames = channels[0].length;
  const dataLen = frames * numCh * 2;
  const buf = Buffer.alloc(44 + dataLen);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numCh * 2, 28);
  buf.writeUInt16LE(numCh * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);

  let pos = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      buf.writeInt16LE(sample | 0, pos);
      pos += 2;
    }
  }
  return buf;
}
