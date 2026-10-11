import { WebSocket } from './deps.mjs';
import { wav, mockTone } from './audio.mjs';

export function ttsRequest(settings) {
  return {
    model: settings.model,
    input: [{ type: 'user_input', content: [{ type: 'text', text: settings.text,
      annotations: [{ type: 'speech_metadata', style: settings.condition || '自然な日本語で、明瞭に読み上げる。' }] }] }],
    response_format: { type: 'audio', mime_type: 'audio/wav' },
    generation_config: { speech_config: [{ voice: settings.voice }] },
    store: false,
  };
}
export async function synthesize(settings, { key, signal, mock, fetcher = fetch }) {
  if (mock) return { audio: wav(mockTone(), 24000), usage: null };
  const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(ttsRequest(settings)), signal, redirect: 'error',
  });
  // Do not forward provider errors: these can include URLs, keys or request text.
  if (!response.ok) throw new Error(`Google request failed (HTTP ${response.status})`);
  const body = await response.json();
  const audio = body.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(c => c.type === 'audio').at(-1);
  if (!audio?.data) throw new Error('No audio returned');
  const bytes = Buffer.from(audio.data, 'base64');
  if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new Error('Expected WAV audio');
  return { audio: bytes, usage: body.usage ?? null };
}
export function liveSetup(settings) {
  return { setup: {
    model: `models/${settings.model}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } } } },
    systemInstruction: { parts: [{ text: `日本語で短く自然に対話してください。${settings.condition}` }] },
    realtimeInputConfig: { automaticActivityDetection: settings.mode === 'manual' ? { disabled: true } : { disabled: false, silenceDurationMs: 700 } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
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
      if (message.error) return callbacks.error();
      if (message.setupComplete) callbacks.ready();
      callbacks.message(message);
    } catch { callbacks.error(); }
  });
  ws.on('error', () => { if (!closed) callbacks.error(); });
  ws.on('close', () => { if (!closed) callbacks.close(); });
  return {
    send(message) {
      if (closed || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1024 * 1024) throw new Error('Live connection unavailable');
      ws.send(JSON.stringify(message));
    },
    close() { closed = true; ws.terminate(); },
  };
}
