import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceSnippets, snippetDocs } from '../lib/snippets.mjs';
import { ttsRequest, liveSetup } from '../lib/google.mjs';
import { voiceProfiles } from '../lib/catalog.mjs';
import { demoSettings } from '../lib/voice-demos.mjs';

const options = { liveModel: 'gemini-3.8-live', ttsModel: demoSettings.model, text: demoSettings.text, style: demoSettings.condition, instruction: '日本語で短く自然に対話してください。', checkedAt: '2026-10-11' };

test('every voice gets a prompt, a Live setup and a TTS request', () => {
  for (const profile of voiceProfiles.voices) {
    const snippets = voiceSnippets(profile, options);
    assert.deepEqual(snippets.map(s => s.id), ['prompt', 'live', 'tts']);
    const live = JSON.parse(snippets[1].text), tts = JSON.parse(snippets[2].text);
    assert.equal(live.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, profile.name);
    assert.deepEqual(tts.generation_config.speech_config, [{ voice: profile.name }]);
    assert.ok(snippets[0].text.includes(`「${profile.name}」`) && snippets[0].text.includes(snippetDocs.live) && snippets[0].text.includes(snippetDocs.tts));
  }
});

test('published code matches what the app actually sends', () => {
  const kore = voiceProfiles.voices.find(v => v.name === 'Kore');
  const [live, tts] = voiceSnippets(kore, options).slice(1).map(s => JSON.parse(s.text));
  assert.deepEqual(tts, ttsRequest({ model: options.ttsModel, voice: 'Kore', text: options.text, condition: options.style }));
  const sent = liveSetup({ model: options.liveModel, voice: 'Kore', condition: '', mode: 'automatic' }).setup;
  for (const key of ['model', 'generationConfig', 'systemInstruction']) assert.deepEqual(live.setup[key], sent[key]);
});
