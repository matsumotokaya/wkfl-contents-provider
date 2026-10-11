// One render clock for microphone and speaker audio. Input 0 is the microphone;
// input 1 is the model playback bus. Only input 1 reaches the speakers.
//
// The recording position is the number of frames this processor has rendered
// since recording started. process() runs exactly once per render quantum, so
// that counter is continuous. currentFrame only supplies the origin and a drift
// report: Chrome can hand process() a stale currentFrame for one quantum (the
// same value twice, then a catch-up). Treating that as a backward jump produced
// overlapping chunks that ended paid sessions on 2026-10-11. A forward drift
// that persists for two quanta is kept as a real gap.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false; this.recording = false; this.samples = [];
    this.mic = []; this.speaker = []; this.origin = null; this.frames = 0; this.chunkStart = 0;
    this.lastDrift = 0; this.driftReports = 0;
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
      const drift = currentFrame - this.origin - this.frames;
      if (drift !== 0 && this.driftReports < 20) { this.driftReports++; this.port.postMessage({ type: 'recordingDrift', frames: this.frames, currentFrame, origin: this.origin, drift }); }
      if (drift > 0 && drift === this.lastDrift) { this.flushRecording(); this.chunkStart = this.frames + drift; this.frames += drift; this.lastDrift = 0; }
      else this.lastDrift = drift;
      for (let i = 0; i < rendered.length; i++) { this.mic.push(mic?.[i] || 0); this.speaker.push(rendered[i]); }
      this.frames += rendered.length;
      if (this.mic.length >= 1600) this.flushRecording();
    }
    if (this.active && mic) { this.samples.push(...mic); if (this.samples.length >= 1600) this.flushInput(); }
    return true;
  }
}
registerProcessor('capture', Capture);
