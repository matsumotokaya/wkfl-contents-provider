import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, validate, voiceProfiles } from '../lib/catalog.mjs';

test('every selectable voice has a profile with gender, style and demo link', () => {
  const names = voiceProfiles.voices.map(v => v.name);
  assert.equal(names.length, 30);
  assert.equal(new Set(names).size, 30);
  for (const kind of ['tts', 'live']) {
    assert.deepEqual([...catalog[kind].voices].sort(), [...names].sort());
    assert.ok(catalog[kind].voices.includes(catalog[kind].defaultVoice));
    if (kind === 'live') assert.equal(catalog.live.defaultVoiceByProvider.google, 'Aoede');
  }
  for (const v of voiceProfiles.voices) {
    assert.ok(['female', 'male', 'neutral'].includes(v.gender), v.name);
    assert.ok(v.style && v.styleJa, v.name);
    assert.match(v.demoUrl, /^https:\/\/docs\.cloud\.google\.com\/static\/text-to-speech\/docs\/audio\/chirp3-hd-[a-z]+\.wav$/);
  }
  // Gemini API voices list (2026-10-11): 13 female, 16 male, Pulcherrima neutral.
  assert.deepEqual(['female', 'male', 'neutral'].map(g => voiceProfiles.voices.filter(v => v.gender === g).length), [13, 16, 1]);
});

test('validation accepts any listed voice and rejects unknown ones', () => {
  const live = { model: 'gemini-3.8-live', voice: 'Sulafat', condition: '', seconds: 30, mode: 'automatic' };
  assert.equal(validate('live', live).voice, 'Sulafat');
  assert.throws(() => validate('live', { ...live, voice: 'Nonexistent' }));
  assert.equal(validate('tts', { model: 'gemini-3.8-flash-tts', voice: 'Achird', text: 'テスト' }).voice, 'Achird');
});
