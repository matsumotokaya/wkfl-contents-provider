import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { Timeline } from '../lib/timeline.mjs';

function worklet() {
  let Processor; const messages = [];
  const scope = vm.createContext({
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value), onmessage: null }; } },
    registerProcessor: (_name, value) => { Processor = value; }, currentFrame: 8000,
  });
  vm.runInContext(readFileSync(new URL('../public/audio-worklet.js', import.meta.url), 'utf8'), scope);
  const instance = new Processor();
  const command = data => instance.port.onmessage({ data });
  const render = (mic, speaker) => {
    const output = new Float32Array(1600);
    instance.process([[mic], [speaker]], [[output]]); scope.currentFrame += 1600; return output;
  };
  return { instance, messages, command, render, scope };
}

test('worklet common clock preserves 100ms silence, mic, played response and cancelled tail', () => {
  const w = worklet(); const zero = new Float32Array(1600), mic = new Float32Array(1600).fill(.25), model = new Float32Array(1600).fill(.5);
  w.command('record'); w.command('start');
  w.render(zero, zero); w.render(mic, zero);
  assert.equal(w.render(zero, model)[0], .5);
  // A cancelled BufferSource contributes zeros to the next render quantum.
  assert.equal(w.render(zero, zero)[0], 0);
  w.command('finish');
  const timeline = new Timeline();
  for (const m of w.messages) {
    if (m.type === 'recordingStarted') timeline.start(m.frameOrigin);
    if (m.type === 'recordingChunk') timeline.append({ startFrame: m.startFrame, input: Buffer.from(m.input).toString('base64'), playback: Buffer.from(m.playback).toString('base64') });
    if (m.type === 'recordingEnd') timeline.end(m.frames);
  }
  const tracks = timeline.render();
  assert.equal(timeline.metadata().durationMs, 400); assert.equal(timeline.metadata().frameOrigin, 8000);
  assert.equal(tracks.input.readInt16LE(44), 0);
  assert.equal(tracks.input.readInt16LE(44 + 1600 * 2), 8192);
  assert.equal(tracks.output.readInt16LE(44 + 3200 * 2), 16384);
  assert.equal(tracks.output.readInt16LE(44 + 4800 * 2), 0);
  assert.equal(tracks.input.length, tracks.output.length);
  assert.equal(timeline.metadata().complete, true);
});
test('partial quantum is flushed before recordingEnd; microphone is never monitored to speaker', () => {
  const w = worklet(); w.command('record');
  const mic = new Float32Array(128).fill(.3), output = new Float32Array(128);
  w.instance.process([[mic], []], [[output]]);
  assert.ok(output.every(v => v === 0));
  w.command('finish');
  const chunks = w.messages.filter(m => m.type === 'recordingChunk');
  assert.equal(chunks[0].input.byteLength, 256);
  assert.equal(w.messages.at(-1).type, 'recordingEnd'); assert.equal(w.messages.at(-1).frames, 128);
});
test('missing packets are explicit gaps; overlapping chunks are dropped as anomalies, oversized ones rejected', () => {
  const t = new Timeline(100); const data = Buffer.alloc(20).toString('base64');
  t.start(0); assert.equal(t.append({ startFrame: 10, input: data, playback: data }), null);
  assert.deepEqual(t.append({ startFrame: 15, input: data, playback: data }), { type: 'overlap', startFrame: 15, frames: 10, endFrame: 20 });
  assert.throws(() => t.append({ startFrame: 95, input: data, playback: data }));
  assert.equal(t.endFrame, 20);
  t.end(20); assert.equal(t.metadata().complete, false); assert.deepEqual(t.metadata().gaps, [{ fromFrame: 0, toFrame: 10 }]);
  assert.equal(t.metadata().anomalies.length, 1);
});
test('a stale currentFrame for one quantum keeps chunks contiguous and is reported as drift', () => {
  const w = worklet(); const mic = new Float32Array(1600).fill(.1), zero = new Float32Array(1600);
  const quantum = () => { w.instance.process([[mic], [zero]], [[new Float32Array(1600)]]); };
  w.command('record');
  quantum(); w.scope.currentFrame += 1600; quantum();            // 0..3200 rendered, clock consistent
  quantum();                                                     // clock not advanced: same currentFrame twice
  w.scope.currentFrame += 3200; quantum();                       // catch-up: clock consistent again
  w.scope.currentFrame += 1600; w.command('finish');
  const chunks = w.messages.filter(m => m.type === 'recordingChunk').map(m => m.startFrame);
  assert.deepEqual(chunks, [0, 1600, 3200, 4800]);
  const drift = w.messages.filter(m => m.type === 'recordingDrift');
  assert.deepEqual(drift.map(m => m.drift), [-1600]);
  assert.equal(w.messages.at(-1).frames, 6400);
  // A forward drift that persists for two quanta is a real gap, inserted once confirmed.
  const g = worklet(); g.command('record');
  g.instance.process([[mic], [zero]], [[new Float32Array(1600)]]); g.scope.currentFrame += 3200;
  g.instance.process([[mic], [zero]], [[new Float32Array(1600)]]); g.scope.currentFrame += 1600;
  g.instance.process([[mic], [zero]], [[new Float32Array(1600)]]); g.scope.currentFrame += 1600;
  g.command('finish');
  assert.deepEqual(g.messages.filter(m => m.type === 'recordingChunk').map(m => m.startFrame), [0, 1600, 4800]);
  assert.deepEqual(g.messages.filter(m => m.type === 'recordingDrift').map(m => m.drift), [1600, 1600]);
  assert.equal(g.messages.at(-1).frames, 6400);
});
