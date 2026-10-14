import { wav, mockTone } from './audio.mjs';
import { minimaxTtsBody } from './snippets.mjs';

export const ttsRequest = settings => minimaxTtsBody({ model: settings.model, voice: settings.voice, text: settings.text });
// Billing-relevant fields only. usage_voice_count appears only on the call that activates a cloned voice ($1.5 once).
const usageFields = ['usage_characters', 'usage_voice_count', 'audio_length', 'audio_sample_rate', 'audio_format', 'word_count'];
export async function synthesize(settings, { key, signal, mock, fetcher = fetch }) {
  if (mock) return { audio: wav(mockTone(), 24000), usage: null };
  const response = await fetcher('https://api.minimax.io/v1/t2a_v2', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(ttsRequest(settings)), signal, redirect: 'error',
  });
  // Provider messages are not forwarded; MiniMax reports failures as a numeric base_resp.status_code
  // (1002 rate limit, 1004 authentication, 2013 invalid parameters), which is safe to keep.
  if (!response.ok) throw new Error(`MiniMax request failed (HTTP ${response.status})`);
  const body = await response.json();
  const code = body.base_resp?.status_code;
  if (code !== 0) throw new Error(`MiniMax request failed (status_code ${Number.isInteger(code) ? code : 'missing'})`);
  const hex = body.data?.audio;
  if (typeof hex !== 'string' || !hex.length || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) throw new Error('No audio returned');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new Error('Expected WAV audio');
  const extra = body.extra_info || {};
  const usage = Object.fromEntries(usageFields.filter(field => extra[field] !== undefined).map(field => [field, extra[field]]));
  if (typeof body.trace_id === 'string' && /^[\w-]{1,80}$/.test(body.trace_id)) usage.trace_id = body.trace_id;
  return { audio: bytes, usage };
}
