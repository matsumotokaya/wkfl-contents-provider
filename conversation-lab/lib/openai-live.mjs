import { WebSocket } from './deps.mjs';
import { upsample16kTo24k } from './audio.mjs';
import { redactProviderBody } from './google.mjs';
import { liveSessionStart } from './snippets.mjs';
export { liveSessionStart };

// GPT-Live (gpt-live-1) over a server-side WebSocket, translated to and from the Live message shape the
// server already uses. Full duplex: there is no turn-complete or interruption event.
// Spec: https://developers.openai.com/api/docs/guides/live-conversations; event reference mirrored at
// https://learn.microsoft.com/azure/foundry/openai/gpt-live-reference (checked 2026-10-12).
export function toLiveEvents(message) {
  const input = message.realtimeInput || {};
  if (input.audio) return [{ type: 'session.input_audio.append', audio: upsample16kTo24k(Buffer.from(input.audio.data, 'base64')).toString('base64') }];
  // Making the model speak first: trusted instructions with no delegation target.
  if (typeof input.text === 'string') return [{ type: 'session.instructions.append', content: input.text, delegation_id: null }];
  return [];
}
// Transcript deltas carry approximate speech times; the docs say to group by them, not by arrival.
const speechTimes = event => (Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms) ? { startMs: event.start_ms, endMs: event.end_ms } : {});
export function fromLiveEvent(event) {
  switch (event.type) {
    case 'session.output_audio.delta': return { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: event.delta } }] } } };
    case 'session.input_transcript.delta': return { serverContent: { inputTranscription: { text: event.delta, ...speechTimes(event) } } };
    case 'session.output_transcript.delta': return { serverContent: { outputTranscription: { text: event.delta, ...speechTimes(event) } } };
    // Cumulative voice seconds (snapshots, not increments).
    case 'session.usage.updated': case 'session.closed': return event.usage ? { providerUsage: { source: 'openai-live-voice', value: { ...event.usage, final: event.type === 'session.closed', reason: event.reason } } } : null;
    case 'session.delegation.created': return { providerEvent: { name: 'delegation-created', target: event.delegation?.target ?? null } };
    case 'response.event': {
      const nested = event.event || {};
      if (nested.type === 'response.completed' && nested.response?.usage) return { providerUsage: { source: 'openai-live-backend', value: { model: nested.response.model ?? null, usage: nested.response.usage } } };
      return null;
    }
    default: return null;
  }
}
export function connectGptLive(settings, callbacks, { key, Socket = WebSocket }) {
  const ws = new Socket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 15000, maxPayload: 8 * 1024 * 1024 });
  let closed = false, started = false;
  ws.on('open', () => { if (!closed) ws.send(JSON.stringify(liveSessionStart(settings))); });
  ws.on('message', data => {
    if (closed) return; // After close() only the final usage is read (see close).
    let event;
    try { event = JSON.parse(data.toString()); } catch { return callbacks.error({ detail: 'Unreadable provider message' }); }
    if (event.type === 'session.started' && !started) { started = true; if (!closed) callbacks.ready(); return; }
    if (event.type === 'error') {
      const detail = redactProviderBody(JSON.stringify(event.error)).slice(0, 500);
      // A startup error ends the session; a command error after startup does not.
      if (!started) return closed ? undefined : callbacks.error({ detail });
      return callbacks.message({ providerEvent: { name: 'error', detail } });
    }
    const message = fromLiveEvent(event);
    if (message) callbacks.message(message);
  });
  ws.on('error', error => { if (!closed) callbacks.error({ detail: redactProviderBody(error?.message || '').slice(0, 300) }); });
  ws.on('close', (code, reason) => { if (!closed) callbacks.close({ code, reason: redactProviderBody(reason?.toString() || '').slice(0, 300) }); });
  return {
    send(message) {
      if (closed || ws.readyState !== Socket.OPEN) throw Object.assign(new Error(`Live connection not open (state ${ws.readyState})`), { upstream: true });
      if (ws.bufferedAmount > 1024 * 1024) throw Object.assign(new Error('Live upstream backlog'), { upstream: true });
      for (const event of toLiveEvents(message)) ws.send(JSON.stringify(event));
    },
    // Graceful close stops billing and lets session.closed (final seconds) arrive; force-close after a short grace.
    close() {
      if (closed) return; closed = true;
      try { if (ws.readyState === Socket.OPEN) ws.send(JSON.stringify({ type: 'session.close' })); } catch { /* Closing anyway. */ }
      const timer = setTimeout(() => ws.terminate(), 1500); timer.unref?.();
      ws.on('message', data => { try { const event = JSON.parse(data.toString()); const message = fromLiveEvent(event); if (message?.providerUsage) callbacks.message(message); if (event.type === 'session.closed') { clearTimeout(timer); ws.terminate(); } } catch { /* Ignore after close. */ } });
    },
  };
}
