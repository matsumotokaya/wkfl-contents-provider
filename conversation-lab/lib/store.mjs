import { summarizeLive } from './cost.mjs';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { wav } from './audio.mjs';
export class Store {
  constructor(root) { this.root = root; mkdirSync(root, { recursive: true, mode: 0o700 }); }
  begin(kind, settings, mock) {
    const id = randomUUID();
    const item = { id, kind, ...settings, mock, createdAt: new Date().toISOString(), status: 'running', files: [], usage: [], cost: null, metrics: [], events: [], recording: null };
    mkdirSync(join(this.root, id), { mode: 0o700 });
    this.save(item);
    return item;
  }
  save(item) {
    const path = join(this.root, item.id, 'metadata.json');
    writeFileSync(path + '.tmp', JSON.stringify(item, null, 2), { mode: 0o600 });
    renameSync(path + '.tmp', path);
  }
  audio(item, name, bytes) {
    writeFileSync(join(this.root, item.id, name), bytes, { mode: 0o600 });
    if (!item.files.includes(name)) item.files.push(name);
  }
  finishLive(item, input, output, reason, timeline) {
    if (timeline?.origin !== null && timeline?.origin !== undefined) {
      const tracks = timeline.render();
      this.audio(item, 'mix.wav', tracks.mix);
      this.audio(item, 'input.wav', tracks.input);
      this.audio(item, 'output.wav', tracks.output);
      item.recording = timeline.metadata();
    } else {
      item.recording = { schema: 'browser-render-timeline-v1', complete: false, unavailable: true, reason: 'No browser render frames received; transport audio is not substituted.' };
    }
    if (input.length) this.audio(item, 'input-source.wav', wav(Buffer.concat(input), 16000));
    if (output.length) this.audio(item, 'generated.wav', wav(Buffer.concat(output), 24000));
    item.status = reason === 'stopped' || reason === 'time-limit' ? 'completed' : 'interrupted';
    item.endReason = reason; item.endedAt = new Date().toISOString();
    item.costSummary = summarizeLive(item);
    this.save(item);
  }
  list() {
    return readdirSync(this.root).filter(id => /^[a-f0-9-]{36}$/.test(id)).flatMap(id => {
      try { return [JSON.parse(readFileSync(join(this.root, id, 'metadata.json'), 'utf8'))]; } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
