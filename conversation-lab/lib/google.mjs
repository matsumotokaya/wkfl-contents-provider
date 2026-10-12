import { WebSocket } from './deps.mjs';
import { wav, mockTone } from './audio.mjs';
import { liveVoiceSetup, ttsBody } from './snippets.mjs';

export function ttsRequest(settings) {
  return ttsBody({ model: settings.model, voice: settings.voice, text: settings.text, style: settings.condition || '自然な日本語で、明瞭に読み上げる。' });
}
export function quotaHint(raw) {
  try {
    const error = JSON.parse(raw).error || {}, details = error.details || [], message = typeof error.message === 'string' ? error.message : '';
    const ids = details.flatMap(d => d.violations || []).map(v => v.quotaId).filter(id => /^[\w-]{1,120}$/.test(id || ''));
    // The message itself is never forwarded; only "metric: <name>, limit: <n>" pairs are picked out of it.
    const limits = [...message.matchAll(/metric: ([\w./-]{1,160}), limit: (\d{1,9})/g)].map(m => `${m[1]}<=${m[2]}`);
    const delay = details.find(d => /^\d+(\.\d+)?s$/.test(d.retryDelay || ''))?.retryDelay;
    return [/^[A-Z_]{1,40}$/.test(error.status || '') ? ` status=${error.status}` : '', ids.length ? ` quota=${[...new Set(ids)].join(',')}` : '', limits.length ? ` limit=${limits.join(',')}` : '', delay ? ` retryDelay=${delay}` : ''].join('');
  } catch { return ''; }
}
// Key-shaped strings are removed before an error body is kept anywhere.
export const redactProviderBody = raw => String(raw).slice(0, 8000).replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED]').replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
export async function synthesize(settings, { key, signal, mock, fetcher = fetch }) {
  if (mock) return { audio: wav(mockTone(), 24000), usage: null };
  const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(ttsRequest(settings)), signal, redirect: 'error',
  });
  // Do not forward provider errors: these can include URLs, keys or request text.
  // For 429, the message keeps only the quota id and retry delay. The redacted body rides on the error for local diagnosis only.
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const error = new Error(`Google request failed (HTTP ${response.status})${response.status === 429 ? quotaHint(raw) : ''}`);
    error.providerBody = redactProviderBody(raw);
    throw error;
  }
  const body = await response.json();
  const audio = body.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(c => c.type === 'audio').at(-1);
  if (!audio?.data) throw new Error('No audio returned');
  const bytes = Buffer.from(audio.data, 'base64');
  if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new Error('Expected WAV audio');
  return { audio: bytes, usage: body.usage ?? null };
}
// Sent once after setup so the model opens the conversation; the setup itself stays the published one.
export const liveGreetingPrompt = '会話が始まりました。日本語で「こんにちは、今日は何を話しましょうか」のように短く挨拶して、相手に話しかけてください。';
export function liveSetup(settings) {
  return { setup: {
    ...liveVoiceSetup({ model: settings.model, voice: settings.voice, instruction: `日本語で短く自然に対話してください。${settings.condition}` }),
    realtimeInputConfig: { automaticActivityDetection: settings.mode === 'manual' ? { disabled: true } : { disabled: false, silenceDurationMs: 700 } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    // Official session management: compression lifts the 15-minute audio-only limit; resumption
    // lets the server continue the same session on a new connection (connections end after ~10 min).
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: settings.resumeHandle ? { handle: settings.resumeHandle } : {},
  } };
}
export function connectLive(settings, callbacks, { key, mock }) {
  if (mock) {
    let closed = false;
    const readyTimer = setTimeout(() => { if (!closed) callbacks.ready(); }, 10);
    let responseTimer;
    return {
      send(message) {
        if (message.realtimeInput?.activityEnd) {
          responseTimer = setTimeout(() => {
            if (closed) return;
            callbacks.message({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: mockTone().toString('base64') } }] }, outputTranscription: { text: '[MOCK] 合成テスト音。会話生成ではありません。' }, turnComplete: true } });
          }, 30);
        }
      },
      close() { closed = true; clearTimeout(readyTimer); clearTimeout(responseTimer); },
    };
  }
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
  const ws = new WebSocket(url, { handshakeTimeout: 15000, maxPayload: 8 * 1024 * 1024 });
  let closed = false;
  ws.on('open', () => { if (!closed) ws.send(JSON.stringify(liveSetup(settings))); });
  ws.on('message', data => {
    if (closed) return;
    try {
      const message = JSON.parse(data.toString());
      if (message.error) return callbacks.error({ detail: redactProviderBody(JSON.stringify(message.error)).slice(0, 500) });
      if (message.setupComplete) callbacks.ready();
      callbacks.message(message);
    } catch { callbacks.error({ detail: 'Unreadable provider message' }); }
  });
  // Close code and reason are kept for diagnosis; they tell provider-side endings apart from local ones.
  ws.on('error', error => { if (!closed) callbacks.error({ detail: redactProviderBody(error?.message || '').slice(0, 300) }); });
  ws.on('close', (code, reason) => { if (!closed) callbacks.close({ code, reason: redactProviderBody(reason?.toString() || '').slice(0, 300) }); });
  return {
    send(message) {
      // upstream: true marks provider-side unavailability, so the server does not blame the browser for it.
      if (closed || ws.readyState !== WebSocket.OPEN) throw Object.assign(new Error(`Live connection not open (state ${ws.readyState})`), { upstream: true });
      if (ws.bufferedAmount > 1024 * 1024) throw Object.assign(new Error('Live upstream backlog'), { upstream: true });
      ws.send(JSON.stringify(message));
    },
    close() { closed = true; ws.terminate(); },
  };
}
