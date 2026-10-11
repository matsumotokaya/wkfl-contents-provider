const $ = id => document.getElementById(id);
let selectedKind = 'live', selectedModel = 'gemini-3.8-live';
let cfg, busy = false, socket, context, stream, capture, source, playbackBus;
let liveStarting = false, startupVersion = 0, stopping = false, flushTimer;
let talking = false, flushing = false, countdownTimer, deadline, nextPlayback = 0, liveReady = false;
const playback = new Set();
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
function controls() {
  $('generate').disabled = busy || !cfg;
  $('live-start').disabled = busy || !cfg;
  $('tts-stop').disabled = !busy || Boolean(socket) || liveStarting;
  $('live-stop').disabled = stopping || (!socket && !liveStarting);
  $('talk').disabled = !liveReady || flushing || (!cfg?.mock && $('turn-mode').value === 'automatic');
  for (const button of document.querySelectorAll('#models button')) button.disabled = busy;
  for (const id of ['tts-model','tts-voice','text','tts-condition','live-model','live-voice','live-condition','seconds','turn-mode']) $(id).disabled = busy;
}
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lab-Token': cfg.csrf }, body: JSON.stringify(body) } : {});
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
function base64(buffer) { let text = ''; for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b); return btoa(text); }
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function stopPlayback() { for (const node of playback) { try { node.stop(); } catch { /* Already stopped. */ } } playback.clear(); nextPlayback = 0; }
function playAudio(data) {
  if (!context || context.state === 'closed' || stopping) return;
  const raw = atob(data), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const pcm = new DataView(bytes.buffer); const audio = context.createBuffer(1, bytes.length / 2, 24000);
  const channel = audio.getChannelData(0); for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
  const node = context.createBufferSource(); node.buffer = audio; node.connect(playbackBus);
  const start = Math.max(context.currentTime + .02, nextPlayback); nextPlayback = start + audio.duration;
  playback.add(node); node.onended = () => playback.delete(node); node.start(start);
}
function cleanup() {
  liveReady = false; talking = false; flushing = false;
  clearInterval(countdownTimer); stopPlayback();
  clearTimeout(flushTimer); capture?.disconnect(); source?.disconnect(); playbackBus?.disconnect(); stream?.getTracks().forEach(track => track.stop());
  if (context && context.state !== 'closed') context.close().catch(() => {});
  capture = source = playbackBus = stream = context = null;
  $('talk').textContent = cfg?.mock ? 'モック発話を送る' : '話し始める'; $('talk').classList.remove('recording');
  $('countdown').textContent = '—';
}
function flushRecording() {
  if (stopping) return;
  stopping = true; liveReady = false; talking = false;
  clearInterval(countdownTimer); stopPlayback();
  stream?.getTracks().forEach(track => track.stop());
  if (capture && context?.state === 'running') {
    capture.port.postMessage('finish');
    // If a suspended worklet cannot acknowledge, the server marks the final
    // recording incomplete instead of substituting received model audio.
    flushTimer = setTimeout(() => { cleanup(); send({ type: 'stop' }); }, 800);
  } else { cleanup(); send({ type: 'stop' }); }
  controls();
}
function selectModel(kind, model) {
  if (busy) return;
  selectedKind = kind; selectedModel = model;
  $('tts-panel').hidden = kind !== 'tts'; $('live-panel').hidden = kind !== 'live';
  $(`${kind}-model`).value = model;
  for (const button of document.querySelectorAll('#models button')) { button.classList.toggle('selected', button.dataset.model === model); button.setAttribute('aria-pressed', String(button.dataset.model === model)); }
  $('archive-title').textContent = `${model} の履歴`;
  refresh().catch(error => status(error.message, true));
}
async function refresh() {
  const items = (await api('/api/experiments')).filter(item => item.model === selectedModel); $('experiments').replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'このモデルの履歴はまだありません。実行した音声と条件がここに残ります。'; $('experiments').append(empty); return; }
  for (const item of items) {
    const row = document.createElement('article'); row.className = 'experiment';
    const info = document.createElement('div'), media = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = `${item.voice} / ${item.kind.toUpperCase()}${item.mock ? ' · MOCK' : ''}`;
    const model = document.createElement('p'); model.textContent = item.model;
    const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = `${new Date(item.createdAt).toLocaleString('ja-JP')} · ${item.status}`;
    const condition = document.createElement('p'); condition.textContent = item.condition;
    const cost = document.createElement('p'); cost.textContent = item.mock ? '合成テスト音・課金なし・実測比較対象外' : `費用未算出 / API使用量 ${item.usage?.length ? '取得あり（詳細）' : '未取得'}`;
    info.append(h, model, meta, condition, cost);
    if (item.kind === 'live') { const recording = document.createElement('p'); recording.textContent = item.recording?.schema === 'browser-render-timeline-v1' ? item.recording.complete ? '時間軸を保持した録音 / ブラウザ描画音' : '録音は一部欠損・終了フラッシュ未確認。詳細を確認してください。' : '旧形式：無音を詰めた非同期録音'; info.append(recording); }
    if (item.text) { const text = document.createElement('p'); text.textContent = item.text; media.append(text); }
    for (const file of item.files) {
      const label = document.createElement('p');
      const labels = { 'mix.wav': '会話ミックス / 無音・時間軸を保持', 'input.wav': '自分の入力 / 共通時間軸', 'output.wav': 'ブラウザ再生音 / 共通時間軸', 'input-source.wav': '入力原音 / 送信チャンク連結・非同期', 'generated.wav': '受信原音 / 未再生の部分を含む・非同期', 'speech.wav': '読み上げ音声' };
      if (item.kind === 'live' && item.recording?.schema !== 'browser-render-timeline-v1') { labels['input.wav'] = '旧形式の入力 / チャンク連結・非同期'; labels['output.wav'] = '旧形式の受信音 / 未再生部分を含む・非同期'; }
      label.textContent = labels[file] || file;
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = `/experiments/${item.id}/${file}`;
      audio.addEventListener('play', () => { for (const other of document.querySelectorAll('audio')) if (audio !== other) other.pause(); });
      media.append(label, audio);
    }
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre'), link = document.createElement('a');
    summary.textContent = '条件・使用量・計測データ'; pre.textContent = JSON.stringify(item, null, 2);
    link.href = `/experiments/${item.id}/metadata.json`; link.download = `${item.id}.json`; link.textContent = 'メタデータを保存'; details.append(summary, link, pre); media.append(details);
    row.append(info, media); $('experiments').append(row);
  }
}
$('tts-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; controls(); status(cfg.mock ? 'MOCK：合成テスト音を保存中…' : '1回だけ生成しています…');
  try { await api('/api/tts', { model: $('tts-model').value, voice: $('tts-voice').value, text: $('text').value, condition: $('tts-condition').value }); await refresh(); status('音声と条件をローカルに保存しました。'); }
  catch (error) { status(error.message, true); await refresh().catch(() => {}); }
  finally { busy = false; controls(); }
});
$('tts-stop').onclick = () => api('/api/stop', {}).catch(error => status(error.message, true));
$('refresh').onclick = () => refresh().catch(error => status(error.message, true));
$('live-start').onclick = async () => {
  if (busy) return; busy = true; liveStarting = true; stopping = false; const version = ++startupVersion; controls(); status('会話の準備中…');
  try {
    context = new AudioContext({ sampleRate: 16000 }); await context.resume();
    if (version !== startupVersion) return;
    if (!cfg.mock) {
      const requestedStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (version !== startupVersion) { requestedStream.getTracks().forEach(track => track.stop()); return; }
      stream = requestedStream;
    }
    await context.audioWorklet.addModule('/audio-worklet.js');
    if (version !== startupVersion) return;
    if (context.sampleRate !== 16000) throw new Error('16 kHzの音声入力に対応するブラウザを使用してください。');
    capture = new AudioWorkletNode(context, 'capture', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    playbackBus = context.createGain(); playbackBus.connect(capture, 0, 1); capture.connect(context.destination);
    context.onstatechange = () => { if (liveReady && context?.state !== 'running') { status('音声処理が停止したためセッションを終了します。録音は一部欠損の可能性があります。', true); send({ type: 'stop' }); flushRecording(); } };
    if (stream) { source = context.createMediaStreamSource(stream); source.connect(capture, 0, 0); }
    capture.port.onmessage = ({ data }) => {
      if (data.type === 'pcm' && !stopping) send({ type: 'audio', data: base64(data.buffer) });
      if (data.type === 'flushed' && flushing && !stopping) { send({ type: 'activityEnd' }); flushing = false; controls(); }
      if (data.type === 'recordingStarted') send({ type: 'recordingStarted', frameOrigin: data.frameOrigin });
      if (data.type === 'recordingChunk') send({ type: 'recordingChunk', startFrame: data.startFrame, input: base64(data.input), playback: base64(data.playback) });
      if (data.type === 'recordingEnd') { send({ type: 'recordingEnd', frames: data.frames }); send({ type: 'stop' }); cleanup(); }
      if (data.type === 'recordingUnavailable') { send({ type: 'stop' }); cleanup(); }
    };
    if (version !== startupVersion) return;
    liveStarting = false;
    socket = new WebSocket(`ws://${location.host}/live`, ['wkfl', cfg.csrf]);
    controls();
    socket.onopen = () => send({ type: 'start', model: $('live-model').value, voice: $('live-voice').value, condition: $('live-condition').value, seconds: Number($('seconds').value), mode: $('turn-mode').value });
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'ready') {
        capture.port.postMessage('record');
        liveReady = true; deadline = Date.now() + message.seconds * 1000; $('transcript').replaceChildren();
        countdownTimer = setInterval(() => { $('countdown').textContent = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); }, 250);
        if (!cfg.mock && $('turn-mode').value === 'automatic') { capture.port.postMessage('start'); $('talk').textContent = 'マイク送信中'; }
        $('latency').textContent = $('turn-mode').value === 'automatic' ? '自然会話：音声の区切りはサーバーが検出します。発話終了から実再生までの遅延は未計測です。' : '手動区切り：発話終了通知 → 最初の音声受信（サーバー）を計測します。';
        status(cfg.mock ? 'MOCK接続。マイクは使いません。合成テスト音を送れます。' : $('turn-mode').value === 'automatic' ? '接続しました。そのまま話してください。マイク送信中です。' : '接続しました。「話し始める」でマイク送信を開始します。'); controls();
      }
      if (message.type === 'audio') playAudio(message.data);
      if (message.type === 'drain') flushRecording();
      if (message.type === 'interrupted') stopPlayback();
      if (message.type === 'transcript') { const p = document.createElement('p'); p.textContent = `${message.role === 'user' ? '自分' : 'モデル'}：${message.text}`; $('transcript').append(p); $('transcript').scrollTop = $('transcript').scrollHeight; }
      if (message.type === 'metric') $('latency').textContent = `${cfg.mock ? 'MOCK / ' : ''}発話終了通知 → 最初の音声受信（サーバー）：${message.metric.value} ms。実再生開始の遅延ではありません。`;
      if (message.type === 'error') status(message.message, true);
      if (message.type === 'saved') { status(`録音を保存しました（${message.item.endReason}）。`); refresh().catch(error => status(error.message, true)); }
    };
    socket.onerror = () => status('接続できませんでした。設定を確認し、必要なら手動で再開してください。', true);
    socket.onclose = () => { cleanup(); socket = null; busy = false; stopping = false; controls(); };
  } catch (error) { if (version !== startupVersion) return; liveStarting = false; cleanup(); socket?.close(); socket = null; busy = false; controls(); status(error.message, true); }
};
$('talk').onclick = () => {
  if (!liveReady || flushing) return;
  if (cfg.mock) { send({ type: 'mockTurn' }); return; }
  talking = !talking;
  if (talking) { stopPlayback(); send({ type: 'activityStart' }); capture.port.postMessage('start'); status('マイク音声を送信中。話し終えたら「発話を送る」を押してください。'); }
  else { flushing = true; capture.port.postMessage('stop'); status('応答を待っています…'); }
  $('talk').textContent = talking ? '発話を送る' : '話し始める'; $('talk').classList.toggle('recording', talking); controls();
};
$('live-stop').onclick = () => {
  ++startupVersion; liveStarting = false;
  if (socket?.readyState === WebSocket.OPEN) { send({ type: 'stop' }); flushRecording(); }
  else { cleanup(); socket?.close(); socket = null; busy = false; controls(); }
};
window.addEventListener('pagehide', () => { send({ type: 'stop' }); socket?.close(); cleanup(); });
try {
  cfg = await api('/api/config');
  for (const kind of ['tts', 'live']) {
    for (const [suffix, values] of [['model', cfg.catalog[kind].models], ['voice', cfg.catalog[kind].voices]]) for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value; $(`${kind}-${suffix}`).append(option); }
    for (const model of cfg.catalog[kind].models) {
      const button = document.createElement('button'); button.dataset.model = model; button.textContent = model;
      const small = document.createElement('small'); small.textContent = kind === 'live' ? '自然会話 / 接続実装済み・未試験' : '読み上げ / 接続実装済み・未試験';
      button.append(small); button.onclick = () => selectModel(kind, model); $('models').append(button);
    }
    $(`${kind}-model`).onchange = () => selectModel(kind, $(`${kind}-model`).value);
    $(`${kind}-note`).textContent = cfg.catalog[kind].status;
  }
  $('text').value = cfg.sampleText; $('mode').textContent = cfg.mock ? 'MOCK / 課金なし' : 'LOCAL / API使用';
  $('credentials').textContent = `資格情報の参照方式：${cfg.credentialSource}（値は表示しません）`;
  if (cfg.mock) { for (const node of document.querySelectorAll('.api-notice')) node.textContent = 'MOCK：外部API・マイクを使いません。保存されるのは合成テスト音です。'; $('talk').textContent = 'モック発話を送る'; }
  status(cfg.mock ? 'モックモードです。声質・反応速度の実測比較には使えません。' : '準備できました。生成・接続はボタンを押したときだけ実行します。');
  selectModel(selectedKind, selectedModel); controls();
} catch (error) { status(`読み込みに失敗しました：${error.message}`, true); }
