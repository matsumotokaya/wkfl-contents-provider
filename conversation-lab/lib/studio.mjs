// Studio (番組づくり): use cases, show formats and the shared expression presets. The settings a
// person chooses here are the same for every model; buildInterview turns them into the instruction
// text and the opening cue the server sends. Each model keeps its own base instruction on the
// server. Pure module: used by the server, the browser and the tests.
export const useCases = [
  { id: 'podcast', name: 'ポッドキャスト番組', formats: [
    { id: 'interview', name: 'インタビュー', ready: true, summary: 'AIがホストになってあなたに質問し、話を掘り下げます。答えていくだけで番組が1本できます。' },
    { id: 'news', name: 'ニュース解説', ready: false },
    { id: 'talk', name: '対談', ready: false },
  ] },
  { id: 'youtube', name: 'YouTube番組', formats: [] },
];

// The host's personality and manner of speaking.
export const hostPresets = [
  { id: 'calm', name: '落ち着いた聞き手', text: '落ち着いたトーンで、ゆっくり丁寧に話す。丁寧語。相手の言葉を短く受け止めてから次を聞き、安心して話せる空気をつくる。' },
  { id: 'bright', name: '明るいMC', text: '明るく軽快に、テンポよく話す。丁寧語だが堅すぎない。リアクションは素直に大きめで、話を楽しんでいることが伝わるようにする。' },
  { id: 'reporter', name: '鋭い記者', text: '好奇心が強く率直。丁寧語。曖昧な答えには「具体的には？」「なぜそう考えたんですか？」と踏み込む。ただし詰問にはせず、敬意を保つ。' },
];

// How the questions are asked.
export const interviewStyles = [
  { id: 'deep', name: '深掘り', text: 'テーマを一つに絞り、なぜ・どうやって・その結果どうなったかを順に掘り下げる。同じ話題で3〜4問続けてから、別の角度に移る。' },
  { id: 'radio', name: 'ラジオ風', text: '一つの話題に長くとどまらず、テンポよく話題を広げる。答えやすい質問から始め、意外な一面や笑える話を引き出す。' },
  { id: 'story', name: '体験を聞く', text: '時系列に沿って、きっかけ・転機・苦労・いま、の順に体験を聞く。その場面や気持ちを具体的に語ってもらう。' },
];

export const defaultInterview = { title: '', guest: '', theme: '', profile: '', host: 'calm', style: 'deep', extra: '' };

// Sent once when the conversation is ready, so the host opens the show.
export const interviewOpening = '収録を始めます。番組のオープニングから始めてください。';
// Director cues sent from the studio page during a session. Each provider receives them as its own
// instruction channel (lib/google.mjs, lib/openai.mjs, lib/openai-live.mjs).
export const studioCues = {
  'wrap-up': '（進行の合図）そろそろ終わりの時間です。ゲストの今の話を受け止めたら、今日の話の要点を2〜3文でまとめ、ゲストにお礼を言って、番組を締めてください。',
};

// What a studio session records about itself; only ready formats are accepted.
export function validateStudio(value) {
  const useCase = useCases.find(u => u.id === value?.useCase), format = useCase?.formats.find(f => f.id === value?.format && f.ready);
  if (!format) throw new Error('Invalid studio format');
  const text = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return { useCase: useCase.id, format: format.id, title: text(value.title, 100), theme: text(value.theme, 200), guest: text(value.guest, 50) };
}
const clean = value => (typeof value === 'string' ? value.trim() : '');
export function buildInterview(input = {}) {
  const s = { ...defaultInterview, ...input };
  const host = hostPresets.find(p => p.id === s.host) || hostPresets[0];
  const style = interviewStyles.find(p => p.id === s.style) || interviewStyles[0];
  const title = clean(s.title), guest = clean(s.guest), theme = clean(s.theme), profile = clean(s.profile), extra = clean(s.extra);
  const guestName = guest ? `${guest}さん` : 'ゲスト';
  const sections = [
    `あなたはポッドキャストのインタビュー番組${title ? `「${title}」` : ''}のホストです。${guest ? `ゲストは${guestName}です。` : 'ゲストを一人迎えています。'}これは収録で、あなたとゲストの声がそのまま番組になります。`,
    theme && `# 今日のテーマ\n${theme}`,
    profile && `# ゲストについて（事前に知っていること）\n${profile}`,
    `# ホストの人格と話し方（${host.name}）\n${host.text}`,
    `# 聞き方（${style.name}）\n${style.text}`,
    [
      '# 進行',
      `- オープニング：${title ? '番組名を名乗り、' : ''}${guestName}を紹介し、${theme ? '今日のテーマを一言で伝えてから最初の質問をする' : '今日どんな話をしたいかをゲストに聞くところから始める'}。30秒以内。`,
      '- 本編：質問は一度に一つだけ。ゲストの答えから具体的な言葉を拾って次の質問につなげる（エピソード、理由、そのときの気持ち、数字や固有名詞）。',
      '- 聞き手に徹する。自分の意見や長い解説はしない。相づちは短くする。',
      '- ゲストが話している間は遮らない。答えに詰まったら、答えやすい形に言い換えて聞き直す。',
      '- 話が一巡したら、別の角度の質問に移る。',
      '- 締め：「進行の合図」で締めるよう指示されたら、今日の話の要点を2〜3文でまとめ、ゲストにお礼を言って番組を締める。それまでは締めない。',
    ].join('\n'),
    extra && `# 追加の指示\n${extra}`,
  ];
  return { instruction: sections.filter(Boolean).join('\n\n'), opening: interviewOpening, studio: { useCase: 'podcast', format: 'interview', title: title.slice(0, 100), theme: theme.slice(0, 200), guest: guest.slice(0, 50) } };
}
