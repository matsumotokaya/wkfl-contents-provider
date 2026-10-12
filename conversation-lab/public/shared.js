// Small view helpers shared by the model lab (/) and the studio (/studio).
import { groupTranscript, toBlocks } from '/transcript.mjs';

export const $ = id => document.getElementById(id);
export function externalLink(href, text) { const link = document.createElement('a'); link.href = href; link.textContent = text; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }
const endLabels = { stopped: '停止ボタンで終了', 'time-limit': '設定した上限時間で終了', 'provider-closed': 'AI側が接続を終了（APIの上限など。記録の provider-close を確認）', 'provider-error': 'AI側のエラーで終了', 'provider-unavailable': 'AI側の接続が使えず終了', 'invalid-request': 'サーバーが拒否して終了（不具合。記録を確認）', 'client-closed': 'ブラウザ側の切断で終了', 'client-unavailable': 'ブラウザが応答せず終了', 'client-error': 'ブラウザ接続のエラーで終了', 'setup-timeout': '接続の準備が時間切れ', 'invalid-provider-data': 'AI側のデータ異常で終了', 'size-limit': '保存上限で終了', 'server-stopped': 'サーバーの停止で中断' };
export const endLabel = reason => endLabels[reason] || reason || '';
export const formatClock = seconds => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');

// Live transcript in a log element. The server groups fragments into speaker lines
// (lib/transcript.mjs) and sends each fragment with its line index; paragraphs are redrawn
// at most a few times a second, and the view follows the end only when it is already there.
export function createTranscriptView(box) {
  let lines = [], timer = null;
  function render() {
    timer = null;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.querySelector('.muted')?.remove();
    const blocks = toBlocks(lines), rows = box.querySelectorAll('p.line');
    blocks.forEach((block, i) => {
      let p = rows[i];
      if (!p) { p = document.createElement('p'); const who = document.createElement('span'), body = document.createElement('span'); who.className = 'who'; p.append(who, body); box.append(p); }
      p.className = `line ${block.role}`; p.firstChild.textContent = block.role === 'user' ? '自分' : 'モデル'; p.lastChild.textContent = block.text;
    });
    for (let i = blocks.length; i < rows.length; i++) rows[i].remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  return {
    reset() { lines = []; clearTimeout(timer); timer = null; box.replaceChildren(); },
    add(message) {
      if (!Number.isInteger(message.index) || message.index < 0) return;
      const line = lines[message.index] ??= { role: message.role, text: '', atMs: message.atMs, untilMs: message.untilMs };
      line.text += message.text; line.atMs = message.atMs; line.untilMs = message.untilMs;
      timer ??= setTimeout(render, 200);
    },
  };
}
// History: sessions from 2026-10-12 store grouped lines; older ones store fragments and are grouped here.
export const savedTranscript = item => toBlocks(item.transcriptFormat === 'speaker-lines-v1' ? (item.events || []).filter(e => e.type === 'transcript') : groupTranscript(item.events));
