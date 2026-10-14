import { summarizeLive, summarizeTts, pricingByModel, ttsPricingByModel } from '/cost.mjs';
import { voiceSnippets, openaiVoiceSnippets, gptLiveVoiceSnippets, minimaxVoiceSnippets } from '/snippets.mjs';
import { createLiveSession } from '/live-session.js';
import { $, externalLink, endLabel, formatClock, createTranscriptView, savedTranscript } from '/shared.js';
let selectedKind = 'live', selectedModel = 'gemini-3.8-live';
let cfg, busy = false, live = null, countdownTimer;
const transcriptView = createTranscriptView($('transcript'));
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
function controls() {
  $('generate').disabled = busy || !cfg;
  $('live-start').disabled = busy || !cfg;
  $('tts-stop').disabled = !busy || Boolean(live?.active);
  $('live-stop').disabled = !live?.active || live.stopping;
  $('talk').disabled = !live?.ready || live.flushing || (!cfg?.mock && $('turn-mode').value === 'automatic');
  for (const button of document.querySelectorAll('#models button')) button.disabled = busy;
  for (const id of ['tts-model','tts-voice','text','tts-condition','live-model','live-voice','live-condition','live-delegate','seconds','turn-mode']) $(id).disabled = busy;
  if (busy) stopDemo();
}
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lab-Token': cfg.csrf }, body: JSON.stringify(body) } : {});
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
const modalityLabel = { TEXT: 'テキスト', AUDIO: '音声', IMAGE: '画像', VIDEO: '動画', UNCLASSIFIED: '内訳なし', THINKING: 'thinking', CACHED_TEXT: 'テキスト（キャッシュ）', CACHED_AUDIO: '音声（キャッシュ）', TRANSCRIPTION: '文字起こし' };
const money = (usdValue, fx) => usdValue === null ? '不明' : `$${usdValue.toFixed(4)}（約${(usdValue * fx.usdJpy).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}円）`;
const tokens = value => (value ?? 0).toLocaleString('ja-JP');
function costView(item) {
  const box = document.createElement('div'); box.className = 'cost-summary';
  const p = (text, className) => { const node = document.createElement('p'); node.textContent = text; if (className) node.className = className; return node; };
  if (item.kind === 'tts') {
    const t = item.costSummary ?? summarizeTts(item);
    if (!t) return box;
    box.append(p(`この生成の概算：${money(t.usd, t.fx)}`, 'cost-total'));
    box.append(p(`課金対象 ${t.characters ?? '不明'}文字 × $${t.pricing.perMillionChars}/100万文字${t.activations ? `　＋ クローンボイスの初回利用料 $${t.pricing.voiceActivation}（この生成で声が有効化されたため。以後はかかりません）` : ''}`, 'note'));
    box.append(p(`1ドル＝${t.fx.usdJpy}円（${t.fx.label}・${t.fx.date}）で換算。MiniMaxが返した文字数からの概算で、請求額ではありません。`, 'note'));
    return box;
  }
  const summary = summarizeLive(item);
  if (!summary) return box;
  const fx = summary.fx;
  if (!summary.observations.length) {
    box.append(p('このセッションの概算：不明（Googleからの使用量通知が届いていません。0円ではありません）', 'cost-total'));
  } else {
    box.append(p(`このセッションの概算：${money(summary.sessionUsd, fx)}`, 'cost-total'));
    box.append(p(`${summary.pricing.provider === 'openai-live' ? '考える役のトークン' : 'トークン'}：入力 ${tokens(summary.tokens.input)} ・ 出力 ${tokens(summary.tokens.output)} ・ thinking ${tokens(summary.tokens.thinking)}　／　経過 ${summary.elapsedSeconds ?? '—'}秒 ・ 録音 ${summary.recordingSeconds ?? '—'}秒`, 'note'));
    if (summary.missingNotices) box.append(p(`最後の応答が途中で終わったため、その分（${summary.missingNotices}回）の使用量通知は届いておらず、この金額に含まれていません。実際はこれより少し多くなります。`, 'note cost-warning'));
  }
  box.append(p(`1ドル＝${fx.usdJpy}円（${fx.label}・${fx.date}）で換算。受信した使用量通知を合計した概算で、請求額ではありません。`, 'note'));
  if (summary.observations.length) {
    const details = document.createElement('details'), title = document.createElement('summary');
    details.className = 'cost-details'; title.textContent = `内訳（使用量通知 ${summary.observations.length}件）`; details.append(title);
    let responseNumber = 0;
    summary.observations.forEach(o => {
      const notice = document.createElement('div'); notice.className = 'cost-notice';
      const at = o.atMs === null ? '時刻不明' : (o.atMs / 1000).toFixed(1) + '秒時点';
      const label = o.kind === 'voice' ? `会話の音声（gpt-live-1・${o.seconds === null ? '—' : Math.round(o.seconds)}秒・${o.final ? 'OpenAIの確定値' : '推定（経過時間と途中経過の大きいほう）'}）`
        : o.kind === 'backend' ? `考える役（${o.model ?? '不明'}・${at}）`
        : o.kind === 'transcription' ? `入力音声の文字起こし（${o.model}・${at}）` : `通知${++responseNumber}（${at}）`;
      notice.append(p(`${label}：${money(o.usd, fx)}`, 'cost-notice-head'));
      for (const direction of ['input', 'output']) {
        const parts = o.lines.filter(l => l.direction === direction).map(l => `${modalityLabel[l.modality] || l.modality} ${tokens(l.tokens)}`);
        if (parts.length) notice.append(p(`${direction === 'input' ? '入力' : '出力'}：${parts.join(' ・ ')} tokens`));
      }
      details.append(notice);
    });
    const r = summary.pricing;
    if (r.provider === 'openai-live') { details.append(p(`音声は ${r.voicePerMinute} USD/分 × 秒数。考える役は tokens × 単価 ÷ 1,000,000（出力に推論分を含む。前回と同じ入力はキャッシュ単価）。`, 'note'), externalLink(r.source, '公式料金')); box.append(details); return box; }
    const common = `使用量通知はAIの1回の応答ごとに届きます。入力には毎回それまでの会話全体が含まれるため、回を追うごとに増えます。各通知の金額＝tokens × 単価 ÷ 1,000,000 の合計。単価（${r.checkedAt}確認・USD/100万tokens）：入力 テキスト${r.input.TEXT}・音声${r.input.AUDIO}／出力 テキスト${r.output.TEXT}・音声${r.output.AUDIO}。`;
    const specific = r.provider === 'openai'
      ? `前回と同じ部分の入力はキャッシュ単価（テキスト${r.cachedInput.TEXT}・音声${r.cachedInput.AUDIO}）。入力音声の文字起こしは ${r.transcription.model}（入力${r.transcription.input}・出力${r.transcription.output}）で別に計算。`
      : 'thinkingはテキスト出力、「内訳なし」の入力はテキスト入力の単価で計算（Googleは単価の区分を明記していないため）。';
    details.append(p(common + specific, 'note'), externalLink(r.source, '公式料金'));
    box.append(details);
  }
  return box;
}

// What the provider itself allows per session, so a cut by the API is never mistaken for a fault here.
function renderSessionLimit(model) {
  const limit = cfg.catalog.live.sessionLimits?.[model], box = $('live-limit');
  box.replaceChildren();
  if (!limit) return;
  box.append('API の上限：' + limit.official + '。' + limit.handling + ' ', externalLink(limit.source, '公式資料'));
}
function selectModel(kind, model) {
  if (busy) return;
  selectedKind = kind; selectedModel = model;
  renderPricing(model);
  $('model-specs').hidden = model !== 'gemini-3.8-live';
  const provider = providerOf(kind, model);
  $('openai-guide').hidden = !provider.startsWith('openai');
  if (kind === 'live') {
    const live = provider === 'openai-live';
    $('delegate-field').hidden = !live;
    if (live) $('turn-mode').value = 'automatic';
    if (!cfg.mock) { $('turn-mode').hidden = live; document.querySelector('label[for="turn-mode"]').hidden = live; }
  }
  $(`${kind}-note`).textContent = cfg.catalog[kind].statusByModel?.[model] || cfg.catalog[kind].status;
  // MiniMax has no free-text reading instruction, so the field is hidden rather than silently ignored.
  if (kind === 'tts') { const minimax = provider === 'minimax'; $('tts-condition').hidden = minimax; document.querySelector('label[for="tts-condition"]').hidden = minimax; }
  if (kind === 'live') renderSessionLimit(model);
  if (renderedProvider[kind] !== providerOf(kind, model)) voiceCatalog(kind, model);
  $('tts-panel').hidden = kind !== 'tts'; $('live-panel').hidden = kind !== 'live';
  $(`${kind}-model`).value = model;
  for (const button of document.querySelectorAll('#models button')) { button.classList.toggle('selected', button.dataset.model === model); button.setAttribute('aria-pressed', String(button.dataset.model === model)); }
  $('archive-title').textContent = `${model} の履歴`;
  refresh().catch(error => status(error.message, true));
}
const genderLabel = { female: '女性', male: '男性', neutral: 'ニュートラル' };
const voiceValue = kind => document.querySelector(`input[name="${kind}-voice"]:checked`)?.value;
const providerOf = (kind, model) => cfg.catalog[kind].providers?.[model] || 'google';
const profilesFor = provider => provider === 'openai-live' ? cfg.gptLiveVoiceProfiles.voices : provider === 'openai' ? cfg.openaiVoiceProfiles.voices : provider === 'minimax' ? cfg.minimaxVoiceProfiles.voices : cfg.voiceProfiles.voices;
const renderedProvider = {};
let demoAudio, demoButton;
function stopDemo() { demoAudio?.pause(); if (demoButton) demoButton.textContent = demoButton.dataset.label; demoAudio = demoButton = null; }
function playDemo(button, url) {
  const same = demoButton === button; stopDemo(); if (same) return;
  const audio = new Audio(url), failed = () => { if (demoAudio === audio) stopDemo(); button.textContent = '再生できません'; };
  demoAudio = audio; demoButton = button; button.textContent = '■ 停止';
  audio.onended = () => { if (demoAudio === audio) stopDemo(); };
  audio.onerror = failed; audio.play().catch(failed);
}
function voiceCatalog(kind, model) {
  const provider = providerOf(kind, model), box = $(`${kind}-voice-cards`);
  stopDemo(); box.replaceChildren(); renderedProvider[kind] = provider;
  if (provider === 'openai' || provider === 'openai-live') return openaiVoiceCatalog(kind, box, provider);
  if (provider === 'minimax') return minimaxVoiceCatalog(kind, box);
  const profiles = cfg.voiceProfiles.voices.filter(v => cfg.catalog[kind].voices.includes(v.name));
  $(`${kind}-voice`).querySelector('.voice-guide').textContent = `Google公式のプリセット${profiles.length}種。LiveとTTSのどちらでも使えます。声の名前で決まるのは声質と特徴語の傾向までで、性格や話し方は「${kind === 'live' ? '会話の条件' : '読み方・比較条件'}」で指示します。日本語での声質は未確認です。`;
  for (const gender of ['female', 'male', 'neutral']) {
    const members = profiles.filter(v => v.gender === gender);
    if (!members.length) continue;
    const heading = document.createElement('h3'), grid = document.createElement('div');
    heading.className = 'voice-group'; heading.textContent = `${genderLabel[gender]}（${members.length}）`; grid.className = 'voice-grid';
    for (const v of members) {
      const card = document.createElement('div'), input = document.createElement('input'), label = document.createElement('label'), head = document.createElement('span'), name = document.createElement('span'), tag = document.createElement('span'), style = document.createElement('span'), styleJa = document.createElement('span'), demos = document.createElement('div');
      card.className = 'voice-card';
      input.type = 'radio'; input.name = `${kind}-voice`; input.id = `${kind}-voice-${v.name}`; input.value = v.name; input.checked = v.name === cfg.catalog[kind].defaultVoice; input.onchange = () => selectedVoice(kind);
      label.htmlFor = input.id; head.className = 'voice-head'; name.className = 'voice-name'; name.textContent = v.name; tag.className = 'tag'; tag.textContent = genderLabel[v.gender];
      style.className = 'voice-style'; style.textContent = v.style; styleJa.className = 'voice-style-ja'; styleJa.textContent = v.styleJa;
      head.append(name, tag); label.append(head, style, styleJa);
      const ja = cfg.voiceDemos.demos[v.name];
      demos.className = 'demos'; demos.append(demoControl(`${v.name}の日本語デモ`, '日本語', ja ? `/voice-demos/ja/${v.name}.wav` : null), demoControl(`${v.name}の英語デモ`, '英語', v.demoUrl));
      card.append(input, label, demos, codePanel(v, kind)); grid.append(card);
    }
    box.append(heading, grid);
  }
  const sources = document.createElement('p'); sources.className = 'note';
  const jaCount = Object.keys(cfg.voiceDemos.demos).length;
  sources.append(`日本語デモ：${cfg.voiceDemos.model} で、全声に同じ文「${cfg.voiceDemos.text}」と同じ指示「${cfg.voiceDemos.condition}」で生成（${jaCount}/${profiles.length}声）。Liveで話す声とは異なる場合があります。英語デモ：${cfg.voiceProfiles.demoNote} `, externalLink(cfg.voiceProfiles.styleSource, '特徴語の出典'), ' · ', externalLink(cfg.voiceProfiles.genderSource, '性別の出典（Gemini API 声一覧）'), ' · ', externalLink(cfg.voiceProfiles.demoSource, '英語デモの出典'), `（${cfg.voiceProfiles.checkedAt}確認。日本語訳は当サイトによる）`);
  box.append(sources);
  selectedVoice(kind);
}
function openaiVoiceCatalog(kind, box, provider) {
  const live = provider === 'openai-live', source = live ? cfg.gptLiveVoiceProfiles : cfg.openaiVoiceProfiles, profiles = source.voices, grid = document.createElement('div');
  $(`${kind}-voice`).querySelector('.voice-guide').textContent = live
    ? `GPT-Live の声${profiles.length}種（GPT-Live-1 の発表で挙がった12種と、初期値の marin）。OpenAIは性別や特徴の説明を公開していません。声は開始後に変えられません。話し方や性格は「会話の条件」で指示します。`
    : `OpenAI Realtime の声${profiles.length}種。OpenAIは性別や特徴の説明を公開していません（marin と cedar が推奨）。声は一度話し始めるとそのセッション中は変えられません。話し方や性格は「会話の条件」で指示します。`;
  grid.className = 'voice-grid';
  for (const v of profiles) {
    const card = document.createElement('div'), input = document.createElement('input'), label = document.createElement('label'), head = document.createElement('span'), name = document.createElement('span');
    card.className = 'voice-card';
    input.type = 'radio'; input.name = `${kind}-voice`; input.id = `${kind}-voice-${v.name}`; input.value = v.name; input.checked = v.name === cfg.catalog[kind].defaultVoiceByProvider[provider]; input.onchange = () => selectedVoice(kind);
    label.htmlFor = input.id; head.className = 'voice-head'; name.className = 'voice-name'; name.textContent = v.name; head.append(name);
    if (v.recommended || v.isDefault) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = v.recommended ? '推奨' : '初期値'; head.append(tag); }
    label.append(head); card.append(input, label);
    if (!live) {
      const ja = cfg.openaiVoiceDemos.demos[v.name], demos = document.createElement('div');
      demos.className = 'demos'; demos.append(demoControl(`${v.name}の日本語デモ`, ja?.transcriptMatches === false ? '日本語 ※' : '日本語', ja ? `/voice-demos/openai-ja/${v.name}.wav` : null));
      card.append(demos);
    }
    card.append(codePanel(v, kind)); grid.append(card);
  }
  const sources = document.createElement('p'); sources.className = 'note';
  const d = cfg.openaiVoiceDemos, count = Object.keys(d.demos).length;
  if (live) sources.append('試聴デモはありません。', externalLink(source.source, '声の出典（GPT-Live-1 の発表）'), `（${source.checkedAt}確認。各声の名前は実際の開始で受け付けられることを確認）`);
  else sources.append(`日本語デモ：${d.model} 自身に、Geminiと同じ文「${d.text}」を読み上げさせたもの（${count}/${profiles.length}声）。会話のときの声に近い形です。※は文字起こしが原文と一致しなかったもの。OpenAIは声ごとの試聴ファイルを公開していません（公式の試聴サイトは読み上げ専用モデルの声）。`, externalLink('https://openai.fm', 'OpenAI.fm'), ' · ', externalLink(cfg.openaiVoiceProfiles.source, '声の一覧の出典'), `（${cfg.openaiVoiceProfiles.checkedAt}確認）`);
  box.append(grid, sources);
  selectedVoice(kind);
}
function minimaxVoiceCatalog(kind, box) {
  const source = cfg.minimaxVoiceProfiles, grid = document.createElement('div');
  $(`${kind}-voice`).querySelector('.voice-guide').textContent = `MiniMax の声${source.voices.length}種。プリセットではなく、このアカウントでクローンした声です（別のアカウントのキーからは使えません）。喋り方まで学習済みのため、読み方の指示はありません。`;
  grid.className = 'voice-grid';
  for (const v of source.voices) {
    const card = document.createElement('div'), input = document.createElement('input'), label = document.createElement('label'), head = document.createElement('span'), name = document.createElement('span'), tag = document.createElement('span'), description = document.createElement('span');
    card.className = 'voice-card';
    input.type = 'radio'; input.name = `${kind}-voice`; input.id = `${kind}-voice-${v.name}`; input.value = v.name; input.checked = v.name === cfg.catalog[kind].defaultVoiceByProvider.minimax; input.onchange = () => selectedVoice(kind);
    label.htmlFor = input.id; head.className = 'voice-head'; name.className = 'voice-name'; name.textContent = v.name; tag.className = 'tag'; tag.textContent = 'クローン';
    description.className = 'voice-style-ja'; description.textContent = `${v.description}（${v.createdAt}作成）`;
    head.append(name, tag); label.append(head, description); card.append(input, label, codePanel(v, kind)); grid.append(card);
  }
  const sources = document.createElement('p'); sources.className = 'note';
  sources.append('クローンの手順・課金・元の音源の記録は MINIMAX.md。', externalLink(source.source, 'T2A の仕様'), `（${source.checkedAt}確認）`);
  box.append(grid, sources);
  selectedVoice(kind);
}
function codePanel(profile, kind) {
  const details = document.createElement('details'), summary = document.createElement('summary');
  details.className = 'voice-code'; summary.textContent = '</> コード'; summary.setAttribute('aria-label', `${profile.name}を使うためのコード`);
  details.append(summary);
  // Built on each open, so the code always names the model selected at that moment.
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    details.replaceChildren(summary);
    const model = $(`${kind}-model`).value;
    const provider = providerOf(kind, model);
    const snippets = provider === 'minimax'
      ? minimaxVoiceSnippets(profile, { model, text: cfg.sampleText, checkedAt: cfg.minimaxVoiceProfiles.checkedAt })
      : provider === 'openai-live'
      ? gptLiveVoiceSnippets(profile, { delegate: $('live-delegate').value, checkedAt: cfg.gptLiveVoiceProfiles.checkedAt })
      : provider === 'openai'
      ? openaiVoiceSnippets(profile, { model, checkedAt: cfg.openaiVoiceProfiles.checkedAt })
      : voiceSnippets(profile, { liveModel: cfg.catalog.live.models[0], ttsModel: cfg.voiceDemos.model, text: cfg.voiceDemos.text, style: cfg.voiceDemos.condition, instruction: '日本語で短く自然に対話してください。', checkedAt: cfg.voiceProfiles.checkedAt });
    for (const snippet of snippets) {
      const block = document.createElement('div'), head = document.createElement('div'), title = document.createElement('span'), copy = document.createElement('button'), pre = document.createElement('pre'), code = document.createElement('code');
      block.className = 'snippet'; head.className = 'snippet-head'; title.textContent = snippet.label; code.textContent = snippet.text;
      copy.type = 'button'; copy.className = 'copy'; copy.textContent = 'コピー'; copy.setAttribute('aria-label', `${profile.name}の${snippet.label}をコピー`);
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(snippet.text); copy.textContent = 'コピーしました'; } catch { copy.textContent = 'コピーできません'; }
        setTimeout(() => { copy.textContent = 'コピー'; }, 1600);
      };
      head.append(title, copy); pre.append(code); block.append(head, pre); details.append(block);
    }
  });
  return details;
}
function demoControl(name, text, url) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'demo';
  if (!url) { button.disabled = true; button.textContent = `${text} 未生成`; button.setAttribute('aria-label', `${name}は未生成`); return button; }
  button.dataset.label = button.textContent = `▶ ${text}`; button.setAttribute('aria-label', `${name}を再生`); button.onclick = () => playDemo(button, url);
  return button;
}
function selectedVoice(kind) {
  const v = profilesFor(renderedProvider[kind]).find(p => p.name === voiceValue(kind));
  $(`${kind}-voice-selected`).textContent = !v ? '' : v.clone ? `選択中：${v.name}（クローン）` : v.gender ? `選択中：${v.name}（${genderLabel[v.gender]}・${v.styleJa}）` : `選択中：${v.name}${v.recommended ? '（推奨）' : v.isDefault ? '（初期値）' : ''}`;
}
function renderGptLivePricing(panel, p, h, para) {
  const table = document.createElement('table'), thead = document.createElement('thead'), body = document.createElement('tbody'), row = cells => { const tr = document.createElement('tr'); for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } return tr; };
  const head = document.createElement('tr'); for (const label of ['対象', '入力', 'キャッシュ入力', '出力']) { const th = document.createElement('th'); th.textContent = label; head.append(th); } thead.append(head);
  body.append(row(['会話の音声（gpt-live-1）', `$${p.voicePerMinute.toFixed(2)} / 分（秒単位）`, '—', '—']));
  for (const [name, r] of Object.entries(p.backend)) body.append(row([`考える役（${name}）`, `$${r.input.toFixed(2)}`, `$${r.cachedInput.toFixed(2)}`, `$${r.output.toFixed(2)}`]));
  table.append(thead, body);
  panel.append(h, para(`公式の標準料金 / 音声はUSD・1分あたり、考える役はUSD・100万tokensあたり / ${p.checkedAt}確認`, 'note'), table,
    para('GPT-Live は、会話の音声を秒単位で、委任先（考える役）のモデルをトークン単位で、別々に課金します。委任しなかった会話は音声代だけです。会話の概算は、OpenAIが送る音声の累計秒数（届かなければ経過時間）と、委任ごとに届くトークン数の合計です。', 'note'),
    externalLink(p.source, '公式料金'), ' · ', externalLink(p.usageSource, 'セッションと使用量の仕様'));
}
function renderTtsPricing(panel, p, h, para) {
  const table = document.createElement('table'), thead = document.createElement('thead'), body = document.createElement('tbody'), row = cells => { const tr = document.createElement('tr'); for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } return tr; };
  const head = document.createElement('tr'); for (const label of ['対象', '単価']) { const th = document.createElement('th'); th.textContent = label; head.append(th); } thead.append(head);
  body.append(row(['読み上げ（課金対象の文字数）', `$${p.perMillionChars} / 100万文字`]), row(['クローンボイスの初回利用', `$${p.voiceActivation} / 声（最初の合成で1回だけ）`]));
  table.append(thead, body);
  panel.append(h, para(`公式の従量課金 / USD / ${p.checkedAt}確認`, 'note'), table,
    para('生成の概算は、MiniMaxが返す課金対象の文字数 × 単価です。nijiVoiceRefA01 は2026-08-12に有効化済みのため、クローンの利用料はもうかかりません。', 'note'),
    externalLink(p.source, '公式料金'), ' · ', externalLink(p.usageSource, 'T2A の仕様'));
}
function renderPricing(model) {
  const panel = $('model-pricing'), p = pricingByModel[model] || ttsPricingByModel[model];
  panel.replaceChildren(); panel.hidden = !p;
  if (!p) return;
  const para = (text, className) => { const node = document.createElement('p'); node.textContent = text; if (className) node.className = className; return node; };
  const h = document.createElement('h2'); h.id = 'pricing-title'; h.textContent = `${model} の料金`;
  if (p.provider === 'minimax') return renderTtsPricing(panel, p, h, para);
  if (p.provider === 'openai-live') return renderGptLivePricing(panel, p, h, para);
  const cached = Boolean(p.cachedInput), price = v => v === undefined ? '—' : `$${v.toFixed(2)}`;
  const table = document.createElement('table'), head = document.createElement('tr'), body = document.createElement('tbody');
  for (const label of ['対象', '入力', ...(cached ? ['キャッシュ入力'] : []), '出力']) { const th = document.createElement('th'); th.textContent = label; head.append(th); }
  const thead = document.createElement('thead'); thead.append(head);
  for (const [modality, label] of [['TEXT', 'テキスト'], ['AUDIO', '音声'], ['IMAGE', '画像・動画']]) {
    if (p.input[modality] === undefined) continue;
    const tr = document.createElement('tr');
    for (const value of [label, price(p.input[modality]), ...(cached ? [price(p.cachedInput[modality])] : []), p.output[modality] === undefined ? '対象外' : price(p.output[modality])]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    body.append(tr);
  }
  table.append(thead, body);
  const note = p.provider === 'openai'
    ? `会話の概算は、応答ごとに届く使用量の合計です。応答のたびにそれまでの会話全体が入力として数えられ、前回と同じ部分はキャッシュ単価になります。入力音声の文字起こしは別モデル（${p.transcription.model}：入力$${p.transcription.input}・出力$${p.transcription.output}）の別料金です。`
    : '会話の概算は、AIの応答ごとに届く使用量通知の合計です。出力料金にはthinkingを含むとされ、テキスト出力の単価で計算します。';
  panel.append(h, para(`公式の標準料金 / USD・100万tokensあたり / ${p.checkedAt}確認`, 'note'), table, para(note, 'note'), externalLink(p.source, '公式料金'), ' · ', externalLink(p.usageSource, '使用量の仕様'));
}
async function refresh() {
  const items = (await api('/api/experiments')).filter(item => item.model === selectedModel); $('experiments').replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'このモデルの履歴はまだありません。実行した音声と条件がここに残ります。'; $('experiments').append(empty); return; }
  for (const item of items) {
    const row = document.createElement('article'); row.className = 'experiment';
    const info = document.createElement('div'), media = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = `${item.voice} / ${item.kind.toUpperCase()}${item.studio ? ' · 番組づくり' : ''}${item.mock ? ' · MOCK' : ''}`;
    const model = document.createElement('p'); model.textContent = item.model;
    const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = `${new Date(item.createdAt).toLocaleString('ja-JP')} · ${item.status}` + (item.endReason ? ' · ' + endLabel(item.endReason) : '');
    const condition = document.createElement('p'); condition.textContent = item.condition;
    info.append(h, model, meta, condition);
    if (item.error) { const error = document.createElement('p'); error.className = 'note cost-warning'; error.textContent = `失敗の理由：${item.error}`; info.append(error); }
    if (item.mock) { const cost = document.createElement('p'); cost.textContent = '合成テスト音・課金なし・実測比較対象外'; info.append(cost); }
    info.append(costView(item));
    if (item.kind === 'live') { const log = document.createElement('details'), title = document.createElement('summary'); title.textContent = '保存済み対話ログ'; log.append(title); for (const line of savedTranscript(item)) { const p = document.createElement('p'); p.textContent = `${line.role === 'user' ? '自分' : 'モデル'}：${line.text}`; log.append(p); } media.append(log); }
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
  try { await api('/api/tts', { model: $('tts-model').value, voice: voiceValue('tts'), text: $('text').value, condition: $('tts-condition').value }); await refresh(); status('音声と条件をローカルに保存しました。'); }
  catch (error) { status(error.message, true); await refresh().catch(() => {}); }
  finally { busy = false; controls(); }
});
$('tts-stop').onclick = () => api('/api/stop', {}).catch(error => status(error.message, true));
$('refresh').onclick = () => refresh().catch(error => status(error.message, true));
// The conversation runs on the shared live session (public/live-session.js); this page owns its controls.
const liveEvents = {
  status, changed: controls, transcript: message => transcriptView.add(message),
  ready(message) {
    const apiMinutes = cfg.catalog.live.sessionLimits?.[$('live-model').value]?.minutes;
    const deadline = Date.now() + (apiMinutes ? Math.min(message.seconds, apiMinutes * 60) : message.seconds) * 1000;
    transcriptView.reset(); $('session-summary').replaceChildren();
    countdownTimer = setInterval(() => { $('countdown').textContent = formatClock(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))); }, 250);
    if (!cfg.mock && $('turn-mode').value === 'automatic') $('talk').textContent = 'マイク送信中';
    $('latency').textContent = cfg.mock ? 'デモ用のタイマーです。AIは応答しません。音声会話や応答速度の測定はできません。' : $('turn-mode').value === 'automatic' ? '自然会話：音声の区切りはサーバーが検出します。発話終了から実再生までの遅延は未計測です。' : '手動区切り：発話終了通知 → 最初の音声受信（サーバー）を計測します。';
    status(cfg.mock ? 'デモ確認中です。会話はできません。「デモ音を再生」で合成テスト音だけを確認できます。' : $('turn-mode').value === 'automatic' ? '接続しました。そのまま話してください。マイク送信中です。' : '接続しました。「話し始める」でマイク送信を開始します。');
  },
  metric(metric) { $('latency').textContent = `${cfg.mock ? 'MOCK / ' : ''}発話終了通知 → 最初の音声受信（サーバー）：${metric.value} ms。実再生開始の遅延ではありません。`; },
  saved(item) { $('session-summary').replaceChildren(costView(item)); status('録音を保存しました。' + endLabel(item.endReason) + '。'); refresh().catch(error => status(error.message, true)); },
  cleanup() { clearInterval(countdownTimer); $('talk').textContent = cfg?.mock ? 'デモ音を再生（会話ではありません）' : '話し始める'; $('talk').classList.remove('recording'); $('countdown').textContent = '—'; },
  closed() { busy = false; controls(); },
};
$('live-start').onclick = () => {
  if (busy) return; busy = true; controls(); status('会話の準備中…');
  live.start({ model: $('live-model').value, voice: voiceValue('live'), condition: $('live-condition').value, seconds: Number($('seconds').value), mode: $('turn-mode').value, ...(providerOf('live', $('live-model').value) === 'openai-live' ? { delegate: $('live-delegate').value } : {}) });
};
$('talk').onclick = () => {
  if (!live.ready || live.flushing) return;
  if (cfg.mock) { live.talk(); return; }
  const talking = live.talk();
  status(talking ? 'マイク音声を送信中。話し終えたら「発話を送る」を押してください。' : '応答を待っています…');
  $('talk').textContent = talking ? '発話を送る' : '話し始める'; $('talk').classList.toggle('recording', talking); controls();
};
$('live-stop').onclick = () => live.stop();
try {
  cfg = await api('/api/config');
  live = createLiveSession({ csrf: cfg.csrf, mock: cfg.mock, on: liveEvents });
  const delegateLabels = { 'gpt-6-luna': '標準・低価格', 'gpt-6-sol': '高性能' };
  for (const model of cfg.catalog.live.delegates) { const option = document.createElement('option'); option.value = model; option.textContent = `${model}（${delegateLabels[model] || model}）`; $('live-delegate').append(option); }
  for (const kind of ['tts', 'live']) {
    for (const value of cfg.catalog[kind].models) { const option = document.createElement('option'); option.value = value; option.textContent = value; $(`${kind}-model`).append(option); }
    for (const model of cfg.catalog[kind].models) {
      const button = document.createElement('button'); button.dataset.model = model; button.textContent = model;
      const small = document.createElement('small'); small.textContent = cfg.mock ? 'デモ表示のみ / AI未接続' : kind === 'tts' ? (providerOf(kind, model) === 'minimax' ? 'MiniMax / 読み上げ' : 'Google / 読み上げ') : { openai: 'OpenAI / Realtime', 'openai-live': 'OpenAI / GPT-Live' }[providerOf(kind, model)] || 'Google / Live';
      button.append(small); button.onclick = () => selectModel(kind, model); $('models').append(button);
    }
    $(`${kind}-model`).onchange = () => selectModel(kind, $(`${kind}-model`).value);
    voiceCatalog(kind, cfg.catalog[kind].models[0]);
  }
  $('text').value = cfg.sampleText; $('mode').textContent = cfg.mock ? 'デモ / AI未接続' : '実接続 / API課金あり';
  $('mode-notice').textContent = cfg.mock ? 'デモモード：AIには接続しません。音声会話はできません。料金は発生しません。' : '実接続モード：音声の生成・会話の開始操作からAPI料金が発生します。Liveの接続のみ確認済み。マイク会話・声質・実額は未検証です。';
  $('mode-notice').classList.toggle('api-mode', !cfg.mock);
  $('credentials').textContent = `資格情報の参照方式：Google ${cfg.credentialSource} / OpenAI ${cfg.openaiCredentialSource} / MiniMax ${cfg.minimaxCredentialSource}（値は表示しません）`;
  if (cfg.mock) {
    for (const node of document.querySelectorAll('.api-notice')) node.textContent = 'デモの動作確認です。外部API・マイクは使わず、保存されるのは合成テスト音です。';
    $('live-start').textContent = 'デモの動作を確認';
    $('talk').textContent = 'デモ音を再生（会話ではありません）';
    $('live-stop').textContent = 'デモを終了・保存';
    $('generate').textContent = 'デモ音を1回保存';
    $('live-title').textContent = '音声UIのデモ';
    $('live-subtitle').textContent = 'DEMO / AIとの会話はできません';
    $('seconds-label').textContent = 'デモ時間（使いすぎ防止の上限）';
    $('live-note').textContent = 'モデル・声は画面確認用の選択肢です。実際の音声会話には接続しません。';
    $('tts-note').textContent = 'この声での読み上げは行いません。合成テスト音だけを保存します。';
    $('turn-mode').hidden = true;
    document.querySelector('label[for="turn-mode"]').hidden = true;
    $('latency').textContent = 'AI応答・会話・反応速度の計測はありません。デモのタイマーと保存だけを確認できます。';
  }
  status(cfg.mock ? '現在はデモです。AIとの会話を開始するボタンではありません。' : '準備できました。生成・接続はボタンを押したときだけ実行します。');
  selectModel(selectedKind, selectedModel); controls();
} catch (error) { status(`読み込みに失敗しました：${error.message}`, true); }
