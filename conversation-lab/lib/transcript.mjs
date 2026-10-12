// Groups transcript fragments into readable speaker lines. Full-duplex models (GPT-Live)
// send the listener's backchannels ("うん。") while the speaker's transcript is still
// arriving, and punctuation often arrives as a fragment of its own, so arrival order alone
// chops words in half ("けど" became "け" / "ど"). Times are the provider's speech times when
// it sends them (GPT-Live start_ms / end_ms, which its docs say to use for grouping), else
// arrival times. Rules, per speaker:
// - punctuation-only fragments always join that speaker's open line;
// - other fragments join it when they start within gapMs of its last fragment and the other
//   speaker has said no more than a backchannel since then.
// Shared by the server (storage), the live view and the history view.
export const GAP_MS = 2500;
const strip = text => String(text).replace(/[\s。、，．,.!?！？…・「」『』()（）[\]ー〜~-]/g, '');
export const isPunctuationOnly = text => strip(text) === '';
export const isBackchannel = text => strip(text).length <= 6;
export class TranscriptGrouper {
  constructor(gapMs = GAP_MS) { this.gapMs = gapMs; this.open = { user: null, model: null }; this.lines = []; }
  // Returns { line, created }. `line` is live: later fragments extend its text and untilMs.
  add(role, text, atMs, untilMs = atMs) {
    const mine = this.open[role], other = this.open[role === 'user' ? 'model' : 'user'];
    if (mine && isPunctuationOnly(text)) { mine.text += text; return { line: mine, created: false }; }
    if (mine && atMs - mine.untilMs <= this.gapMs) {
      // What the other speaker said after my last fragment; a backchannel does not end my line.
      const since = other ? other.recent.filter(p => p.atMs > mine.untilMs).map(p => p.text).join('') : '';
      if (isBackchannel(since)) {
        mine.text += text; mine.untilMs = Math.max(mine.untilMs, untilMs); remember(mine, atMs, text);
        return { line: mine, created: false };
      }
    }
    const line = { role, text, atMs, untilMs };
    // Working state only: not enumerable, so never saved with the line.
    Object.defineProperty(line, 'recent', { value: [] });
    Object.defineProperty(line, 'index', { value: this.lines.length });
    remember(line, atMs, text);
    this.open[role] = line; this.lines.push(line);
    return { line, created: true };
  }
  // A provider turn boundary (Gemini turnComplete, Realtime response.done) ends that speaker's line.
  close(role) { this.open[role] = null; }
}
function remember(line, atMs, text) { line.recent.push({ atMs, text }); if (line.recent.length > 50) line.recent.shift(); }
// Re-groups stored events: per-fragment records from older sessions or already grouped lines.
export function groupTranscript(events, gapMs = GAP_MS) {
  const grouper = new TranscriptGrouper(gapMs);
  for (const event of events || []) {
    if (event.type === 'transcript' && typeof event.text === 'string') grouper.add(event.role, event.text, event.atMs ?? 0, event.untilMs ?? event.atMs ?? 0);
  }
  return grouper.lines;
}
// A backchannel said while the other speaker was mid-line, and not followed closely by more
// from the same speaker, is an aside: it stays in the saved data but not in the paragraphs.
function isAside(lines, index, gapMs) {
  const line = lines[index];
  if (!isBackchannel(line.text)) return false;
  let other = null;
  for (let i = index - 1; i >= 0 && !other; i--) if (lines[i].role !== line.role) other = lines[i];
  if (!other || line.atMs < other.atMs || line.atMs > other.untilMs) return false;
  let next = null;
  for (let i = index + 1; i < lines.length && !next; i++) if (lines[i].role === line.role) next = lines[i];
  return !next || next.atMs - line.untilMs > gapMs;
}
const leadingPunctuation = /^[\s。、，．,.]+/;
// Display paragraphs: asides dropped, consecutive lines of one speaker merged, leading punctuation removed.
// Lines are ordered by when they were spoken (stable for equal times).
export function toBlocks(lines, gapMs = GAP_MS) {
  const blocks = [], sorted = lines.filter(Boolean).sort((a, b) => a.atMs - b.atMs);
  sorted.forEach((line, index) => {
    if (isAside(sorted, index, gapMs)) return;
    if (blocks.at(-1)?.role === line.role) blocks.at(-1).text += line.text;
    else blocks.push({ role: line.role, text: line.text });
  });
  return blocks.map(block => ({ role: block.role, text: block.text.replace(leadingPunctuation, '') })).filter(block => block.text);
}
