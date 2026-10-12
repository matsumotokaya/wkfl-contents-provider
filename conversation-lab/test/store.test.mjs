import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';

test('a record left running by a server stop is closed at startup so pruning can remove it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-store-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'data'));
  const item = store.begin('live', { model: 'gemini-3.8-live', voice: 'Kore' }, false);
  assert.deepEqual(store.recoverStale(), [item.id]);
  const saved = store.list()[0];
  assert.equal(saved.status, 'interrupted'); assert.equal(saved.endReason, 'server-stopped');
  assert.deepEqual(store.recoverStale(), []);
});
test('history keeps the newest five per model and moves older ones to the trash folder', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wkfl-store-test-')), trash = join(dir, 'trash');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'data'));
  const make = (model, status, i) => { const item = store.begin('live', { model, voice: 'Kore' }, false); item.createdAt = new Date(Date.UTC(2026, 9, 11, 0, i)).toISOString(); item.status = status; store.save(item); return item; };
  const live = Array.from({ length: 7 }, (_, i) => make('gemini-3.8-live', 'completed', i));
  const running = make('gemini-3.8-live', 'running', -1);
  const tts = make('gemini-3.8-flash-tts', 'completed', 0);
  assert.deepEqual(store.prune(5, null), []);
  const moved = store.prune(5, trash);
  assert.deepEqual(moved.sort(), [live[0].id, live[1].id].sort());
  const kept = store.list().map(item => item.id);
  assert.ok(kept.includes(running.id) && kept.includes(tts.id));
  assert.equal(kept.filter(id => live.some(item => item.id === id)).length, 5);
  assert.deepEqual(readdirSync(trash).sort(), moved.map(id => `conversation-lab-${id}`).sort());
});
