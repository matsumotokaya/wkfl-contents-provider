import { summarizeLive } from '/cost.mjs';
import { useCases, hostPresets, interviewStyles, defaultInterview, buildInterview } from '/studio.mjs';
import { createLiveSession } from '/live-session.js';
import { $, externalLink, endLabel, formatClock, createTranscriptView, savedTranscript } from '/shared.js';

// Studio (番組づくり, experimental): pick what to make on the left, set the shared expression
// settings, record with any live model. lib/studio.mjs builds the instruction; the conversation
// itself runs on the same live session code as the model lab.
let cfg, live, busy = false, countdownTimer;
const transcript = createTranscriptView($('transcript'));
const fields = ['title', 'guest', 'theme', 'profile', 'host', 'style', 'extra'];
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const providerOf = model => cfg.catalog.live.providers?.[model] || 'google';
const genderLabel = { female: '女性', male: '男性', neutral: 'ニュートラル' };

// Settings stay in this browser only: the last values and named presets. Losing them is harmless.
const storageKey = 'conversation-lab.studio.v1';
function readStore() { try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; } }
function writeStore(value) { try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Kept for this page only. */ } }
const settings = () => Object.fromEntries(fields.map(id => [id, $(id).value]));
function apply(values = {}) { for (const id of fields) if (typeof values[id] === 'string') $(id).value = values[id]; update(); }
function update() {
  const built = buildInterview(settings());
  $('prompt').textContent = `${built.instruction}\n\n--- 開始の合図 ---\n${built.opening}`;
  $('host-note').textContent = hostPresets.find(p => p.id === $('host').value)?.text || '';
  $('style-note').textContent = interviewStyles.find(p => p.id === $('style').value)?.text || '';
  const store = readStore(); store.last = { ...settings(), model: $('model').value, voice: $('voice').value }; writeStore(store);
}
function renderPresets(selected = '') {
  const saved = readStore().saved || {}, select = $('preset');
  select.replaceChildren(new Option('（選ぶと読み込みます）', ''), ...Object.keys(saved).sort().map(name => new Option(name, name)));
  select.value = saved[selected] ? selected : '';
}
$('preset').onchange = () => { const saved = readStore().saved || {}; if (saved[$('preset').value]) { apply(saved[$('preset').value]); $('preset-name').value = $('preset').value; status(`「${$('preset').value}」を読み込みました。`); } };
$('preset-save').onclick = () => {
  const name = $('preset-name').value.trim(); if (!name) { status('保存する名前を入れてください。', true); return; }
  const store = readStore(); store.saved = { ...store.saved, [name]: settings() }; writeStore(store); renderPresets(name); status(`「${name}」として保存しました（このブラウザ内）。`);
};
$('preset-delete').onclick = () => {
  const name = $('preset').value; if (!name) return;
  const store = readStore(); delete store.saved?.[name]; writeStore(store); renderPresets(); status(`「${name}」を削除しました。`);
};

function controls() {
  $('start').disabled = busy || !cfg;
  $('stop').disabled = !live?.active || live.stopping;
  $('wrap-up').disabled = !live?.ready;
  for (const id of [...fields, 'model', 'voice', 'delegate', 'seconds', 'preset', 'preset-name', 'preset-save', 'preset-delete']) $(id).disabled = busy;
  for (const button of document.querySelectorAll('#use-cases button[data-ready]')) button.disabled = busy;
}
function renderUseCases() {
  const box = $('use-cases');
  for (const useCase of useCases) {
    const group = document.createElement('div'); group.className = 'use-case';
    const head = document.createElement('p'); head.textContent = useCase.name; group.append(head);
    if (!useCase.formats.length) { const button = document.createElement('button'); button.disabled = true; button.textContent = '準備中'; group.append(button); }
    for (const format of useCase.formats) {
      const button = document.createElement('button'); button.textContent = format.name;
      const small = document.createElement('small'); small.textContent = format.ready ? '試せます' : '準備中'; button.append(small);
      if (format.ready) { button.dataset.ready = ''; button.classList.add('selected'); button.setAttribute('aria-pressed', 'true'); $('format-summary').textContent = format.summary; }
      else button.disabled = true;
      group.append(button);
    }
    box.append(group);
  }
}
function voiceLabel(provider, profile) {
  if (provider === 'google') return `${profile.name}（${genderLabel[profile.gender] || '性別不明'}・${profile.styleJa}）`;
  return `${profile.name}${profile.recommended ? '（推奨）' : profile.isDefault ? '（初期値）' : ''}`;
}
function renderVoices(preferred) {
  const model = $('model').value, provider = providerOf(model);
  const profiles = provider === 'openai-live' ? cfg.gptLiveVoiceProfiles.voices : provider === 'openai' ? cfg.openaiVoiceProfiles.voices : cfg.voiceProfiles.voices;
  $('voice').replaceChildren(...profiles.map(p => new Option(voiceLabel(provider, p), p.name)));
  const names = profiles.map(p => p.name);
  $('voice').value = names.includes(preferred) ? preferred : cfg.catalog.live.defaultVoiceByProvider[provider];
  $('delegate-field').hidden = provider !== 'openai-live';
  const limit = cfg.catalog.live.sessionLimits?.[model];
  $('limit').replaceChildren(...(limit ? ['API の上限：' + limit.official + '。' + limit.handling + ' ', externalLink(limit.source, '公式資料')] : []));
}
$('model').onchange = () => { renderVoices($('voice').value); update(); };
$('voice').onchange = update;
for (const id of fields) $(id).addEventListener('input', update);

const usd = item => { const s = summarizeLive(item); return s?.sessionUsd == null ? null : `概算 $${s.sessionUsd.toFixed(4)}（約${(s.sessionUsd * s.fx.usdJpy).toFixed(1)}円）`; };
async function refreshEpisodes() {
  const items = (await (await fetch('/api/experiments')).json()).filter(item => item.studio);
  const box = $('episodes'); box.replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'まだ収録した番組はありません。'; box.append(empty); return; }
  for (const item of items) {
    const row = document.createElement('article'); row.className = 'experiment';
    const info = document.createElement('div'), media = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = `${item.studio.title || 'インタビュー'}${item.studio.guest ? `（ゲスト：${item.studio.guest}さん）` : ''}${item.mock ? ' · MOCK' : ''}`;
    const p = (text, className) => { const node = document.createElement('p'); node.textContent = text; if (className) node.className = className; return node; };
    info.append(h, p(`${new Date(item.createdAt).toLocaleString('ja-JP')} · ${endLabel(item.endReason)}`, 'meta'), p(`${item.model} / ${item.voice}`));
    if (item.studio.theme) info.append(p(`テーマ：${item.studio.theme}`));
    const cost = usd(item); if (cost) info.append(p(cost));
    if (item.files.includes('mix.wav')) { const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = `/experiments/${item.id}/mix.wav`; media.append(p('番組の音声（あなたとAIのミックス）'), audio); }
    const log = document.createElement('details'), title = document.createElement('summary'); title.textContent = '文字起こし'; log.append(title);
    for (const line of savedTranscript(item)) log.append(p(`${line.role === 'user' ? '自分' : 'ホスト'}：${line.text}`));
    media.append(log); row.append(info, media); box.append(row);
  }
}
$('refresh').onclick = () => refreshEpisodes().catch(error => status(error.message, true));

$('start').onclick = () => {
  if (busy) return; busy = true; controls(); status('収録の準備中…'); $('result').textContent = '';
  const built = buildInterview(settings()), model = $('model').value;
  live.start({ model, voice: $('voice').value, condition: built.instruction, opening: built.opening, studio: built.studio, seconds: Number($('seconds').value), mode: 'automatic', ...(providerOf(model) === 'openai-live' ? { delegate: $('delegate').value } : {}) });
};
$('wrap-up').onclick = () => { live.cue('wrap-up'); status('締めの合図を送りました。AIがまとめに入ります。'); };
$('stop').onclick = () => live.stop();

try {
  cfg = await (await fetch('/api/config')).json();
  renderUseCases();
  $('host').replaceChildren(...hostPresets.map(p => new Option(p.name, p.id)));
  $('style').replaceChildren(...interviewStyles.map(p => new Option(p.name, p.id)));
  for (const model of cfg.catalog.live.models) $('model').append(new Option(`${model}（${{ openai: 'OpenAI Realtime', 'openai-live': 'OpenAI GPT-Live' }[providerOf(model)] || 'Google Live'}）`, model));
  for (const model of cfg.catalog.live.delegates) $('delegate').append(new Option(model, model));
  const last = readStore().last || {};
  if (cfg.catalog.live.models.includes(last.model)) $('model').value = last.model;
  renderVoices(last.voice); renderPresets(); apply({ ...defaultInterview, ...last });
  live = createLiveSession({ csrf: cfg.csrf, mock: cfg.mock, on: {
    status, changed: controls, transcript: message => transcript.add(message),
    ready(message) {
      const apiMinutes = cfg.catalog.live.sessionLimits?.[$('model').value]?.minutes;
      const deadline = Date.now() + (apiMinutes ? Math.min(message.seconds, apiMinutes * 60) : message.seconds) * 1000;
      transcript.reset();
      countdownTimer = setInterval(() => { $('countdown').textContent = formatClock(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))); }, 250);
      status(cfg.mock ? 'デモ確認中です。AIには接続していません。' : '収録中です。AIがオープニングから始めます。答えるときはそのまま話してください。');
    },
    saved(item) { $('result').textContent = ['保存しました。', endLabel(item.endReason) + '。', usd(item) || ''].join(' '); status('収録を保存しました。下の「収録した番組」で聞けます。'); refreshEpisodes().catch(error => status(error.message, true)); },
    cleanup() { clearInterval(countdownTimer); $('countdown').textContent = '—'; },
    closed() { busy = false; controls(); },
  } });
  $('mode').textContent = cfg.mock ? 'デモ / AI未接続' : '実接続 / API課金あり';
  $('mode-notice').textContent = cfg.mock ? 'デモモード：AIには接続しません。音声会話はできません。料金は発生しません。' : '実験中のページです。収録を始めるとAPI料金が発生します。録音と文字起こしはローカルに保存します。';
  $('mode-notice').classList.toggle('api-mode', !cfg.mock);
  status('設定を決めて「収録を始める」を押してください。');
  controls(); await refreshEpisodes();
} catch (error) { status(`読み込みに失敗しました：${error.message}`, true); }
