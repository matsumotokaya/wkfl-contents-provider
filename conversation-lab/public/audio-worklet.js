// Batches 16 kHz mono samples. A flush acknowledgement orders the final audio
// frame before activityEnd, so the end of a spoken sentence is not discarded.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super(); this.active = false; this.samples = [];
    this.port.onmessage = ({ data }) => {
      if (data === 'start') { this.samples = []; this.active = true; }
      if (data === 'stop') { this.active = false; this.flush(); this.port.postMessage({ type: 'flushed' }); }
    };
  }
  flush() {
    if (!this.samples.length) return;
    const pcm = new Int16Array(this.samples.length);
    this.samples.forEach((v, i) => { pcm[i] = Math.round(Math.max(-1, Math.min(1, v)) * 32767); });
    this.port.postMessage({ type: 'pcm', buffer: pcm.buffer }, [pcm.buffer]); this.samples = [];
  }
  process(inputs) {
    if (this.active && inputs[0]?.[0]) { this.samples.push(...inputs[0][0]); if (this.samples.length >= 1600) this.flush(); }
    return true;
  }
}
registerProcessor('capture', Capture);
