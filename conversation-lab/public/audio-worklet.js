// One render clock for microphone and speaker audio. Input 0 is the microphone;
// input 1 is the model playback bus. Only input 1 reaches the speakers.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false; this.recording = false; this.samples = [];
    this.mic = []; this.speaker = []; this.origin = null; this.frames = 0; this.chunkStart = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'record') { this.recording = true; }
      if (data === 'start') { this.samples = []; this.active = true; }
      if (data === 'stop') { this.active = false; this.flushInput(); this.port.postMessage({ type: 'flushed' }); }
      if (data === 'finish') {
        this.active = false; this.recording = false;
        // Discard unsent provider input on session stop; no new paid work.
        this.samples = []; this.flushRecording();
        if (this.origin !== null) this.port.postMessage({ type: 'recordingEnd', frames: this.frames });
        else this.port.postMessage({ type: 'recordingUnavailable' });
      }
    };
  }
  encode(samples) {
    const pcm = new Int16Array(samples.length);
    samples.forEach((v, i) => { pcm[i] = Math.round(Math.max(-1, Math.min(1, v)) * 32767); });
    return pcm.buffer;
  }
  flushInput() {
    if (!this.samples.length) return;
    const buffer = this.encode(this.samples);
    this.port.postMessage({ type: 'pcm', buffer }, [buffer]); this.samples = [];
  }
  flushRecording() {
    if (!this.mic.length) return;
    const input = this.encode(this.mic), playback = this.encode(this.speaker);
    this.port.postMessage({ type: 'recordingChunk', startFrame: this.chunkStart, input, playback }, [input, playback]);
    this.mic = []; this.speaker = []; this.chunkStart = this.frames;
  }
  process(inputs, outputs) {
    const rendered = outputs[0][0], mic = inputs[0]?.[0], speaker = inputs[1]?.[0];
    // Cancelling a BufferSource removes its samples here, including the queued
    // tail. Received but never rendered chunks cannot enter this recording.
    for (let i = 0; i < rendered.length; i++) rendered[i] = speaker?.[i] || 0;
    if (this.recording) {
      if (this.origin === null) { this.origin = currentFrame; this.port.postMessage({ type: 'recordingStarted', frameOrigin: this.origin }); }
      const offset = currentFrame - this.origin;
      if (offset !== this.frames) { this.flushRecording(); this.chunkStart = offset; }
      for (let i = 0; i < rendered.length; i++) { this.mic.push(mic?.[i] || 0); this.speaker.push(rendered[i]); }
      this.frames = offset + rendered.length;
      if (this.mic.length >= 1600) this.flushRecording();
    }
    if (this.active && mic) { this.samples.push(...mic); if (this.samples.length >= 1600) this.flushInput(); }
    return true;
  }
}
registerProcessor('capture', Capture);
