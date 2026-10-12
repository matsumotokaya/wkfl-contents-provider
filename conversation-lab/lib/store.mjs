import { summarizeLive } from './cost.mjs';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
  dir(item) { return join(this.root, item.id); }
  audio(item, name, bytes) {
    writeFileSync(join(this.root, item.id, name), bytes, { mode: 0o600 });
    if (!item.files.includes(name)) item.files.push(name);
  }
  // The conversation tracks were streamed to disk by the timeline; only the headers are finalized here.
  finishLive(item, reason, timeline) {
    if (timeline?.origin !== null && timeline?.origin !== undefined) {
      for (const name of timeline.close()) if (!item.files.includes(name)) item.files.push(name);
      item.recording = timeline.metadata();
    } else {
      item.recording = { schema: 'browser-render-timeline-v1', complete: false, unavailable: true, reason: 'No browser render frames received.' };
    }
    item.status = reason === 'stopped' || reason === 'time-limit' ? 'completed' : 'interrupted';
    item.endReason = reason; item.endedAt = new Date().toISOString();
    item.costSummary = summarizeLive(item);
    this.save(item);
  }
  // At startup no session is running, so a 'running' record was cut off by a server stop or crash.
  // It is closed as 'server-stopped' so that history pruning removes it like any other record.
  recoverStale() {
    const stale = this.list().filter(item => item.status === 'running');
    for (const item of stale) { item.status = 'interrupted'; item.endReason = 'server-stopped'; item.endedAt ??= new Date().toISOString(); this.save(item); }
    return stale.map(item => item.id);
  }
  // Keeps the newest `keep` items per model. Older ones move to `trashDir` (recoverable), never hard-deleted.
  // Running items are never moved.
  prune(keep, trashDir) {
    if (!keep || !trashDir) return [];
    const moved = [], seen = new Map();
    for (const item of this.list()) {
      const n = (seen.get(item.model) || 0) + 1; seen.set(item.model, n);
      if (n <= keep || item.status === 'running') continue;
      mkdirSync(trashDir, { recursive: true });
      renameSync(join(this.root, item.id), join(trashDir, `conversation-lab-${item.id}`));
      moved.push(item.id);
    }
    return moved;
  }
  list() {
    return readdirSync(this.root).filter(id => /^[a-f0-9-]{36}$/.test(id)).flatMap(id => {
      try { return [JSON.parse(readFileSync(join(this.root, id, 'metadata.json'), 'utf8'))]; } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
