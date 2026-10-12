import { WebSocket } from './deps.mjs';
import { upsample16kTo24k, wav } from './audio.mjs';
import { redactProviderBody } from './google.mjs';
import { realtimeSessionUpdate } from './snippets.mjs';
export { realtimeSessionUpdate };

// OpenAI Realtime (GA) over a server-side WebSocket. The server speaks the Live message shape it already
// uses for Gemini; this adapter translates both directions so recording, transcripts and cost stay shared.
// Spec: https://developers.openai.com/api/docs/guides/realtime-conversations (checked 2026-10-11)
// Server (Live shape) -> OpenAI client events.
export function toRealtimeEvents(message) {
  const input = message.realtimeInput || {};
  if (input.audio) return [{ type: 'input_audio_buffer.append', audio: upsample16kTo24k(Buffer.from(input.audio.data, 'base64')).toString('base64') }];
  if (typeof input.text === 'string') return [{ type: 'response.create', response: { instructions: input.text } }];
  // A director cue becomes a system message the model reads at its next reply; forcing a reply could
  // collide with one in progress.
  if (typeof message.instruction === 'string') return [{ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: message.instruction }] } }];
  if (input.activityStart) return [{ type: 'input_audio_buffer.clear' }];
  if (input.activityEnd) return [{ type: 'input_audio_buffer.commit' }, { type: 'response.create' }];
  return [];
}
// OpenAI server events -> Live shape. Usage rides along as providerUsage so the server can store it raw.
export function fromRealtimeEvent(event) {
  switch (event.type) {
    case 'response.output_audio.delta': return { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: event.delta } }] } } };
    case 'response.output_audio_transcript.delta': return { serverContent: { outputTranscription: { text: event.delta } } };
    case 'conversation.item.input_audio_transcription.completed': return { serverContent: { inputTranscription: { text: event.transcript } }, providerUsage: event.usage ? { source: 'openai-transcription', value: event.usage } : undefined };
    case 'input_audio_buffer.speech_started': return { serverContent: { interrupted: true } };
    case 'response.done': return { serverContent: { turnComplete: true }, providerUsage: event.response?.usage ? { source: 'openai-realtime', value: event.response.usage } : undefined };
    default: return null;
  }
}
export function connectRealtime(settings, callbacks, { key, Socket = WebSocket }) {
  const ws = new Socket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(settings.model)}`, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 15000, maxPayload: 8 * 1024 * 1024 });
  let closed = false, configured = false;
  // The user's transcript arrives after the model has begun replying. speech_started and the
  // finished transcription share an item_id, so the line is placed where the speech began.
  const speechStarts = new Map();
  ws.on('open', () => { if (!closed) ws.send(JSON.stringify(realtimeSessionUpdate(settings))); });
  ws.on('message', data => {
    if (closed) return;
    try {
      const event = JSON.parse(data.toString());
      if (event.type === 'error') {
        // Before setup an error ends the session; after it, a rejected command is recorded and the conversation goes on.
        const detail = redactProviderBody(JSON.stringify(event.error)).slice(0, 500);
        return configured ? callbacks.message({ providerEvent: { name: 'error', detail } }) : callbacks.error({ detail });
      }
      if (event.type === 'session.updated' && !configured) { configured = true; callbacks.ready(); return; }
      if (event.type === 'input_audio_buffer.speech_started' && event.item_id) {
        speechStarts.set(event.item_id, performance.now());
        if (speechStarts.size > 50) speechStarts.delete(speechStarts.keys().next().value);
      }
      const message = fromRealtimeEvent(event);
      const spoken = message?.serverContent?.inputTranscription;
      if (spoken && speechStarts.has(event.item_id)) { spoken.spokenAt = speechStarts.get(event.item_id); speechStarts.delete(event.item_id); }
      if (message) callbacks.message(message);
    } catch { callbacks.error({ detail: 'Unreadable provider message' }); }
  });
  ws.on('error', error => { if (!closed) callbacks.error({ detail: redactProviderBody(error?.message || '').slice(0, 300) }); });
  ws.on('close', (code, reason) => { if (!closed) callbacks.close({ code, reason: redactProviderBody(reason?.toString() || '').slice(0, 300) }); });
  return {
    send(message) {
      if (closed || ws.readyState !== Socket.OPEN) throw Object.assign(new Error(`Live connection not open (state ${ws.readyState})`), { upstream: true });
      if (ws.bufferedAmount > 1024 * 1024) throw Object.assign(new Error('Live upstream backlog'), { upstream: true });
      for (const event of toRealtimeEvents(message)) ws.send(JSON.stringify(event));
    },
    close() { closed = true; ws.terminate(); },
  };
}

// One-shot reading for catalog demos: the Realtime model reads the given text and nothing else.
export const realtimeReadInstruction = 'あなたは読み上げ専用です。ユーザーが渡した文章だけを、一字一句変えずに読み上げてください。前置き・返事・感想は言わないでください。';
export function speakRealtime(settings, { key, signal, Socket = WebSocket }) {
  return new Promise((resolve, reject) => {
    const ws = new Socket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(settings.model)}`, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 15000, maxPayload: 8 * 1024 * 1024 });
    const pcm = []; let transcript = '', requested = false, finished = false;
    const fail = (message, body = '') => Object.assign(new Error(message), { providerBody: redactProviderBody(body) });
    const finish = (error, value) => {
      if (finished) return; finished = true;
      signal?.removeEventListener('abort', onAbort);
      try { ws.terminate(); } catch { /* Already closed. */ }
      if (error) reject(error); else resolve(value);
    };
    const onAbort = () => finish(new Error('Aborted'));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', output_modalities: ['audio'], instructions: `${realtimeReadInstruction}${settings.condition || ''}`, audio: { input: { turn_detection: null }, output: { format: { type: 'audio/pcm', rate: 24000 }, voice: settings.voice } } } })));
    ws.on('message', data => {
      let event;
      try { event = JSON.parse(data.toString()); } catch { return finish(new Error('Unreadable provider message')); }
      if (event.type === 'error') return finish(fail('OpenAI error', JSON.stringify(event.error)));
      if (event.type === 'session.updated' && !requested) {
        requested = true;
        ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: settings.text }] } }));
        ws.send(JSON.stringify({ type: 'response.create' }));
        return;
      }
      if (event.type === 'response.output_audio.delta') pcm.push(Buffer.from(event.delta, 'base64'));
      if (event.type === 'response.output_audio_transcript.delta') transcript += event.delta;
      if (event.type === 'response.done') {
        const status = event.response?.status;
        if (status && status !== 'completed') return finish(fail(`Response ${status}`, JSON.stringify(event.response.status_details ?? {})));
        if (!pcm.length) return finish(new Error('No audio returned'));
        finish(null, { audio: wav(Buffer.concat(pcm), 24000), usage: event.response?.usage ?? null, transcript });
      }
    });
    ws.on('error', error => finish(fail('Realtime connection failed', error?.message || '')));
    ws.on('close', (code, reason) => finish(fail(`Realtime closed (${code})`, reason?.toString() || '')));
  });
}
