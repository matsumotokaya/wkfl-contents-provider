// Browser side of one live conversation, shared by the model lab (/) and the studio (/studio):
// microphone and AudioWorklet capture on one 16 kHz clock, the playback queue, the /live
// WebSocket, and the bounded recording flush on stop. The page supplies the start settings and
// handles events: status(text, isError), ready(message), transcript(message), metric(metric),
// saved(item), cleanup(), closed() and changed() (redraw controls).
export function createLiveSession({ csrf, mock, on = {} }) {
  let context, stream, capture, source, playbackBus, socket, flushTimer;
  let starting = false, version = 0, stopping = false, ready = false, talking = false, flushing = false, nextPlayback = 0;
  const playback = new Set();
  const emit = (name, ...args) => on[name]?.(...args);
  const send = message => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  const base64 = buffer => { let text = ''; for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b); return btoa(text); };
  function stopPlayback() { for (const node of playback) { try { node.stop(); } catch { /* Already stopped. */ } } playback.clear(); nextPlayback = 0; }
  function playAudio(data) {
    if (!context || context.state === 'closed' || stopping) return;
    const raw = atob(data), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    const pcm = new DataView(bytes.buffer); const audio = context.createBuffer(1, bytes.length / 2, 24000);
    const channel = audio.getChannelData(0); for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
    const node = context.createBufferSource(); node.buffer = audio; node.connect(playbackBus);
    const at = Math.max(context.currentTime + .02, nextPlayback); nextPlayback = at + audio.duration;
    playback.add(node); node.onended = () => playback.delete(node); node.start(at);
  }
  function cleanup() {
    ready = false; talking = false; flushing = false;
    stopPlayback(); clearTimeout(flushTimer);
    capture?.disconnect(); source?.disconnect(); playbackBus?.disconnect(); stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') context.close().catch(() => {});
    capture = source = playbackBus = stream = context = null;
    emit('cleanup');
  }
  function flushRecording() {
    if (stopping) return;
    stopping = true; ready = false; talking = false;
    stopPlayback();
    stream?.getTracks().forEach(track => track.stop());
    if (capture && context?.state === 'running') {
      capture.port.postMessage('finish');
      // If a suspended worklet cannot acknowledge, the server marks the final
      // recording incomplete instead of substituting received model audio.
      flushTimer = setTimeout(() => { cleanup(); send({ type: 'stop' }); }, 800);
    } else { cleanup(); send({ type: 'stop' }); }
    emit('changed');
  }
  function ended() { cleanup(); socket = null; stopping = false; starting = false; emit('closed'); emit('changed'); }
  // Settings: { model, voice, condition, seconds, mode, delegate?, opening?, studio? }. Every ending,
  // including a failed start, emits closed().
  async function start(settings) {
    if (socket || starting) return;
    starting = true; stopping = false; const mine = ++version; emit('changed');
    try {
      context = new AudioContext({ sampleRate: 16000 }); await context.resume();
      if (mine !== version) return;
      if (!mock) {
        const requested = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (mine !== version) { requested.getTracks().forEach(track => track.stop()); return; }
        stream = requested;
      }
      await context.audioWorklet.addModule('/audio-worklet.js');
      if (mine !== version) return;
      if (context.sampleRate !== 16000) throw new Error('16 kHzの音声入力に対応するブラウザを使用してください。');
      capture = new AudioWorkletNode(context, 'capture', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      playbackBus = context.createGain(); playbackBus.connect(capture, 0, 1); capture.connect(context.destination);
      context.onstatechange = () => { if (ready && context?.state !== 'running') { emit('status', '音声処理が停止したためセッションを終了します。録音は一部欠損の可能性があります。', true); send({ type: 'stop' }); flushRecording(); } };
      if (stream) { source = context.createMediaStreamSource(stream); source.connect(capture, 0, 0); }
      capture.port.onmessage = ({ data }) => {
        if (data.type === 'pcm' && !stopping) send({ type: 'audio', data: base64(data.buffer) });
        if (data.type === 'flushed' && flushing && !stopping) { send({ type: 'activityEnd' }); flushing = false; emit('changed'); }
        if (data.type === 'recordingStarted') send({ type: 'recordingStarted', frameOrigin: data.frameOrigin });
        if (data.type === 'recordingChunk') send({ type: 'recordingChunk', startFrame: data.startFrame, input: base64(data.input), playback: base64(data.playback) });
        if (data.type === 'recordingDrift') send({ type: 'recordingDrift', frames: data.frames, currentFrame: data.currentFrame, origin: data.origin, drift: data.drift });
        if (data.type === 'recordingEnd') { send({ type: 'recordingEnd', frames: data.frames }); send({ type: 'stop' }); cleanup(); }
        if (data.type === 'recordingUnavailable') { send({ type: 'stop' }); cleanup(); }
      };
      starting = false;
      socket = new WebSocket(`ws://${location.host}/live`, ['wkfl', csrf]);
      emit('changed');
      socket.onopen = () => send({ type: 'start', ...settings });
      socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.type === 'ready') {
          capture?.port.postMessage('record'); ready = true;
          if (!mock && settings.mode === 'automatic') capture?.port.postMessage('start');
          emit('ready', message); emit('changed');
        }
        if (message.type === 'audio') playAudio(message.data);
        if (message.type === 'drain') flushRecording();
        if (message.type === 'interrupted') stopPlayback();
        if (message.type === 'transcript') emit('transcript', message);
        if (message.type === 'metric') emit('metric', message.metric);
        if (message.type === 'error') emit('status', message.message, true);
        if (message.type === 'saved') emit('saved', message.item);
      };
      socket.onerror = () => emit('status', '接続できませんでした。設定を確認し、必要なら手動で再開してください。', true);
      socket.onclose = ended;
    } catch (error) {
      if (mine !== version) return;
      socket?.close(); ended(); emit('status', error.message, true);
    }
  }
  // Manual turn mode: toggles sending the microphone. Returns whether the microphone is now sending.
  function talk() {
    if (!ready || flushing) return talking;
    if (mock) { send({ type: 'mockTurn' }); return false; }
    talking = !talking;
    if (talking) { stopPlayback(); send({ type: 'activityStart' }); capture.port.postMessage('start'); }
    else { flushing = true; capture.port.postMessage('stop'); }
    emit('changed');
    return talking;
  }
  function stop() {
    ++version;
    if (socket?.readyState === WebSocket.OPEN) { send({ type: 'stop' }); flushRecording(); }
    else { socket?.close(); ended(); }
  }
  // A director cue (lib/studio.mjs studioCues); the server forwards it as an instruction.
  function cue(name) { if (ready) send({ type: 'cue', cue: name }); }
  window.addEventListener('pagehide', () => { send({ type: 'stop' }); socket?.close(); cleanup(); });
  return {
    start, stop, talk, cue,
    get active() { return Boolean(socket) || starting; },
    get ready() { return ready; },
    get stopping() { return stopping; },
    get flushing() { return flushing; },
  };
}
