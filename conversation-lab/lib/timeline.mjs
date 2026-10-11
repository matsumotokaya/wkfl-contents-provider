import { pcmFromBase64, wav } from './audio.mjs';

// Browser sample frames are the only alignment clock. Network arrival times are
// deliberately not used to place audio. Missing packets are marked as gaps. A
// chunk that would overlap audio already placed is dropped and noted as an
// anomaly instead of throwing, so recording bookkeeping can never end a session.
export class Timeline {
  constructor(maxFrames = 302 * 16000) {
    this.maxFrames = maxFrames;
    this.chunks = [];
    this.endFrame = 0;
    this.complete = false;
    this.gaps = [];
    this.anomalies = [];
    this.origin = null;
  }
  start(frameOrigin) {
    if (this.origin !== null || !Number.isSafeInteger(frameOrigin) || frameOrigin < 0) throw new Error('Invalid recording origin');
    this.origin = frameOrigin;
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
    if (startFrame > this.endFrame) this.gaps.push({ fromFrame: this.endFrame, toFrame: startFrame });
    this.chunks.push({ startFrame, mic, speaker });
    this.endFrame = startFrame + mic.length / 2;
    return null;
  }
  end(frames) {
    if (this.origin === null || this.complete || !Number.isSafeInteger(frames) || frames < this.endFrame || frames > this.maxFrames) throw new Error('Invalid recording end');
    if (frames > this.endFrame) this.gaps.push({ fromFrame: this.endFrame, toFrame: frames });
    this.endFrame = frames;
    this.complete = true;
  }
  render() {
    const input = Buffer.alloc(this.endFrame * 2), output = Buffer.alloc(this.endFrame * 2), mix = Buffer.alloc(this.endFrame * 2);
    for (const chunk of this.chunks) { chunk.mic.copy(input, chunk.startFrame * 2); chunk.speaker.copy(output, chunk.startFrame * 2); }
    for (let i = 0; i < this.endFrame; i++) mix.writeInt16LE(Math.round((input.readInt16LE(i * 2) + output.readInt16LE(i * 2)) / 2), i * 2);
    return { input: wav(input, 16000), output: wav(output, 16000), mix: wav(mix, 16000) };
  }
  metadata() {
    return {
      schema: 'browser-render-timeline-v1', sampleRate: 16000, frameOrigin: this.origin,
      frames: this.endFrame, durationMs: this.endFrame / 16, flushReceived: this.complete,
      complete: this.complete && !this.gaps.length && !this.anomalies.length, gaps: this.gaps, anomalies: this.anomalies,
      chunks: this.chunks.map(chunk => ({ startFrame: chunk.startFrame, frames: chunk.mic.length / 2 })),
      input: 'Microphone samples at the AudioWorklet; silence and pauses retained.',
      output: 'Samples actually rendered by the browser Web Audio graph before its destination. Not a physical speaker/loopback recording.',
      mix: 'Equal-length synchronized tracks mixed at 0.5 gain each.',
      raw: 'input-source.wav and generated.wav are concatenated transport sources, not the conversation timeline.',
    };
  }
}
