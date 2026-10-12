import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptGrouper, groupTranscript, toBlocks, isBackchannel, isPunctuationOnly } from '../lib/transcript.mjs';

// Fragments as GPT-Live delivered them on 2026-10-12 (times in ms), interleaved by arrival.
const recorded = [
  ['user', 'えとユニバーサルIOっていう名前のアプリを作ったんですけ', 23448, 27631],
  ['model', 'う', 27632, 27632],
  ['user', 'ど', 27844, 27844],
  ['model', 'んうん。そのアプリは、誰に向けたものなんですか?', 27844, 32351],
  ['user', 'まずパソコンを操作するときって', 35344, 37184],
  ['model', 'はい。', 37185, 37185],
  ['user', 'あの、使い方がわからない画面があったりとか', 38103, 42309],
  ['model', 'うん。', 42310, 42463],
  ['user', '、あのウェブサービスとか', 42628, 43761],
  ['model', '。', 43859, 43859],
  ['user', '多いじゃないです', 52604, 56227],
  ['model', 'そうですね', 56228, 56228],
  ['user', 'か', 56403, 56403],
  ['model', '、わからなくて困ることありますよね。', 56980, 59871],
];
const group = fragments => { const g = new TranscriptGrouper(); for (const f of fragments) g.add(...f); return g.lines; };

test('a word split by an interleaved backchannel stays whole; punctuation joins its own speaker', () => {
  const lines = group(recorded);
  assert.equal(lines[0].text, 'えとユニバーサルIOっていう名前のアプリを作ったんですけど');
  assert.equal(lines[1].text, 'うんうん。そのアプリは、誰に向けたものなんですか?');
  assert.ok(lines.every(line => !isPunctuationOnly(line.text)));
});
test('paragraphs drop backchannels said while the other speaker was mid-line, keep real replies', () => {
  assert.deepEqual(toBlocks(group(recorded)), [
    { role: 'user', text: 'えとユニバーサルIOっていう名前のアプリを作ったんですけど' },
    { role: 'model', text: 'うんうん。そのアプリは、誰に向けたものなんですか?' },
    { role: 'user', text: 'まずパソコンを操作するときってあの、使い方がわからない画面があったりとか、あのウェブサービスとか多いじゃないですか' },
    { role: 'model', text: 'そうですね、わからなくて困ることありますよね。' },
  ]);
});
test('a short reply opener followed closely by the rest of the reply is kept', () => {
  const lines = group([
    ['user', 'ビジネスのアイディアについて話したいです', 12315, 16686],
    ['model', 'いいですね', 16801, 16801],
    ['user', '。', 17021, 17219],
    ['model', '。どんな領域のアイディアを考えてますか?', 17460, 20856],
  ]);
  assert.deepEqual(toBlocks(lines), [
    { role: 'user', text: 'ビジネスのアイディアについて話したいです。' },
    { role: 'model', text: 'いいですね。どんな領域のアイディアを考えてますか?' },
  ]);
});
test('a late transcript placed at its speech start is shown before the reply; a closed turn starts a new line', () => {
  const g = new TranscriptGrouper();
  g.add('model', 'こんにちは。', 0, 2000); g.close('model');
  g.add('model', 'いいですね、ちょっとワ', 9000, 9500);
  g.add('user', '一緒にポッドキャストやりませんか?', 6000, 9600); // arrived after the reply began
  g.add('model', 'クワクします。', 9700, 10200);
  assert.deepEqual(toBlocks(g.lines).map(b => [b.role, b.text]), [
    ['model', 'こんにちは。'], ['user', '一緒にポッドキャストやりませんか?'], ['model', 'いいですね、ちょっとワクワクします。'],
  ]);
});
test('working state is not saved; older per-fragment records regroup the same way', () => {
  const lines = group(recorded.slice(0, 4));
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(lines[0]))), ['role', 'text', 'atMs', 'untilMs']);
  const events = recorded.slice(0, 4).map(([role, text, atMs, untilMs]) => ({ type: 'transcript', role, text, atMs, untilMs }));
  assert.equal(groupTranscript(events)[0].text, 'えとユニバーサルIOっていう名前のアプリを作ったんですけど');
  assert.equal(isBackchannel('うんうん。'), true); assert.equal(isBackchannel('そのアプリは誰に'), false);
});
