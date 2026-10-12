import { openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { pcmFromBase64 } from './audio.mjs';

const RATE = 16000, FILES = ['mix', 'input', 'output'];
function header(dataBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

// Browser sample frames are the only alignment clock. Network arrival times are
// deliberately not used to place audio. Missing packets are marked as gaps. A
// chunk that would overlap audio already placed is dropped and noted as an
// anomaly instead of throwing, so recording bookkeeping can never end a session.
// Audio is written to disk as it arrives (16 kHz mono 16-bit, three files), so
// memory stays flat however long the conversation runs. Headers are refreshed
// every ~10 seconds so a crash still leaves playable files.
export class Timeline {
  constructor(maxFrames = 92 * 60 * RATE) {
    this.maxFrames = maxFrames;
    this.endFrame = 0;
    this.complete = false;
    this.gaps = [];
    this.anomalies = [];
    this.origin = null;
    this.files = null;
    this.chunkCount = 0;
  }
  start(frameOrigin, dir = null) {
    if (this.origin !== null || !Number.isSafeInteger(frameOrigin) || frameOrigin < 0) throw new Error('Invalid recording origin');
    this.origin = frameOrigin;
    if (!dir) return;
    this.files = Object.fromEntries(FILES.map(name => [name, openSync(join(dir, `${name}.wav`), 'w', 0o600)]));
    for (const fd of Object.values(this.files)) writeSync(fd, header(0));
  }
  // Returns null when the chunk was placed, or the anomaly record when it was dropped.
  append({ startFrame, input, playback }) {
    if (this.origin === null || this.complete || !Number.isSafeInteger(startFrame) || startFrame < 0) throw new Error('Invalid recording offset');
    const mic = pcmFromBase64(input), speaker = pcmFromBase64(playback);
    if (mic.length !== speaker.length || startFrame + mic.length / 2 > this.maxFrames) throw new Error('Recording size limit');
    if (startFrame < this.endFrame) {
      const anomaly = { type: 'overlap', startFrame, frames: mic.length / 2, endFrame: this.endFrame };
      if (this.anomalies.length < 20) this.anomalies.push(anomaly);
      return anomaly;
    }
    if (startFrame > this.endFrame) { this.gaps.push({ fromFrame: this.endFrame, toFrame: startFrame }); this.fill(startFrame - this.endFrame); }
    this.write(mic, speaker);
    this.endFrame = startFrame + mic.length / 2;
    if (++this.chunkCount % 100 === 0) this.updateHeaders();
    return null;
  }
  end(frames) {
    if (this.origin === null || this.complete || !Number.isSafeInteger(frames) || frames < this.endFrame || frames > this.maxFrames) throw new Error('Invalid recording end');
    if (frames > this.endFrame) { this.gaps.push({ fromFrame: this.endFrame, toFrame: frames }); this.fill(frames - this.endFrame); }
    this.endFrame = frames;
    this.complete = true;
  }
  // Finalizes headers and releases the files. Returns the file names written (none without a directory).
  close() {
    if (!this.files) return [];
    this.updateHeaders();
    for (const fd of Object.values(this.files)) closeSync(fd);
    this.files = null;
    return FILES.map(name => `${name}.wav`);
  }
  write(mic, speaker) {
    if (!this.files) return;
    const mix = Buffer.alloc(mic.length);
    for (let i = 0; i < mic.length; i += 2) mix.writeInt16LE(Math.round((mic.readInt16LE(i) + speaker.readInt16LE(i)) / 2), i);
    writeSync(this.files.input, mic); writeSync(this.files.output, speaker); writeSync(this.files.mix, mix);
  }
  fill(frames) {
    if (!this.files) return;
    for (let left = frames; left > 0; left -= RATE) {
      const zeros = Buffer.alloc(Math.min(left, RATE) * 2);
      for (const fd of Object.values(this.files)) writeSync(fd, zeros);
    }
  }
  updateHeaders() {
    if (!this.files) return;
    const h = header(this.endFrame * 2);
    for (const fd of Object.values(this.files)) writeSync(fd, h, 0, 44, 0);
  }
  metadata() {
    return {
      schema: 'browser-render-timeline-v1', sampleRate: RATE, frameOrigin: this.origin,
      frames: this.endFrame, durationMs: this.endFrame / 16, flushReceived: this.complete,
      complete: this.complete && !this.gaps.length && !this.anomalies.length, gaps: this.gaps, anomalies: this.anomalies,
      chunks: this.chunkCount,
      input: 'Microphone samples at the AudioWorklet; silence and pauses retained.',
      output: 'Samples actually rendered by the browser Web Audio graph before its destination. Not a physical speaker/loopback recording.',
      mix: 'Equal-length synchronized tracks mixed at 0.5 gain each.',
    };
  }
}
