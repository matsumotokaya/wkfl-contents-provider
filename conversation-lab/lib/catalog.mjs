// 公式プリセット30声。style は Gemini API TTS資料の英語の特徴語、styleJa はその訳（Google公式の訳ではない）。
// gender は Gemini API の声一覧（GET /v1beta/voices の gender＝知覚上の性別表現、2026-10-11取得。原データは catalog-sources/）。
// Google Cloud Gemini-TTS資料の表は Pulcherrima を Female としていたが、Gemini API は neutral で、実測の声の高さも男性域（148Hz）だった。
// demo は Google Cloud資料のデモ列にある英語音声（Chirp 3 HD）のファイル名。
const voiceTable = [
  ['Achernar', 'female', 'Soft', 'やわらかい', 'achernar'],
  ['Achird', 'male', 'Friendly', '親しみやすい', 'achird'],
  ['Algenib', 'male', 'Gravelly', 'しゃがれ声', 'algenib'],
  ['Algieba', 'male', 'Smooth', 'なめらか', 'algieba'],
  ['Alnilam', 'male', 'Firm', 'しっかり', 'alnilam'],
  ['Aoede', 'female', 'Breezy', '軽やか', 'aoeda'],
  ['Autonoe', 'female', 'Bright', '明るい', 'autonoe'],
  ['Callirrhoe', 'female', 'Easy-going', 'おおらか', 'callirrhoe'],
  ['Charon', 'male', 'Informative', '解説向き', 'charon'],
  ['Despina', 'female', 'Smooth', 'なめらか', 'despina'],
  ['Enceladus', 'male', 'Breathy', '息まじり', 'enceladus'],
  ['Erinome', 'female', 'Clear', 'クリア', 'erinome'],
  ['Fenrir', 'male', 'Excitable', '勢いがある', 'fenrir'],
  ['Gacrux', 'female', 'Mature', '大人っぽい', 'gacrux'],
  ['Iapetus', 'male', 'Clear', 'クリア', 'iapetus'],
  ['Kore', 'female', 'Firm', 'しっかり', 'kore'],
  ['Laomedeia', 'female', 'Upbeat', '陽気', 'laomedeia'],
  ['Leda', 'female', 'Youthful', '若々しい', 'leda'],
  ['Orus', 'male', 'Firm', 'しっかり', 'orus'],
  ['Pulcherrima', 'neutral', 'Forward', 'はっきり前に出る', 'pulcherrima'],
  ['Puck', 'male', 'Upbeat', '陽気', 'puck'],
  ['Rasalgethi', 'male', 'Informative', '解説向き', 'rasalgethi'],
  ['Sadachbia', 'male', 'Lively', '生き生き', 'sadachbia'],
  ['Sadaltager', 'male', 'Knowledgeable', '知的', 'sadaltager'],
  ['Schedar', 'male', 'Even', '落ち着いて均一', 'schedar'],
  ['Sulafat', 'female', 'Warm', '温かい', 'sulafat'],
  ['Umbriel', 'male', 'Easy-going', 'おおらか', 'umbriel'],
  ['Vindemiatrix', 'female', 'Gentle', '穏やか', 'vindemiatrix'],
  ['Zephyr', 'female', 'Bright', '明るい', 'zephyr'],
  ['Zubenelgenubi', 'male', 'Casual', 'くだけた', 'zubenelgenubi'],
];
export const voiceProfiles = {
  checkedAt: '2026-10-11',
  styleSource: 'https://ai.google.dev/gemini-api/docs/speech-generation',
  genderSource: 'https://ai.google.dev/api/voices',
  demoSource: 'https://docs.cloud.google.com/text-to-speech/docs/gemini-tts',
  demoNote: 'Google Cloud資料のデモ（英語・Chirp 3 HD）。Gemini 3.8 Live / TTSで日本語を話したときの声と同じとは限りません。',
  voices: voiceTable.map(([name, gender, style, styleJa, demo]) => ({
    name, gender, style, styleJa,
    demoUrl: `https://docs.cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-${demo}.wav`,
  })),
};
const voiceNames = voiceTable.map(([name]) => name);
// OpenAI Realtime voices (docs list, 2026-10-11). OpenAI publishes no gender or style labels; marin/cedar are recommended.
const openaiVoiceNames = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
// GPT-Live voices: the twelve named in the GPT-Live-1 announcement plus the documented default marin.
// Each was accepted by session.start on 2026-10-12 (a non-existent name is rejected); case-insensitive.
const gptLiveVoiceNames = ['marin', 'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam', 'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder'];
export const gptLiveVoiceProfiles = {
  checkedAt: '2026-10-12',
  source: 'https://community.openai.com/t/introducing-gpt-live-1-in-the-api/1396471',
  voices: gptLiveVoiceNames.map(name => ({ name, recommended: false, isDefault: name === 'marin' })),
};
export const openaiVoiceProfiles = {
  checkedAt: '2026-10-11',
  source: 'https://developers.openai.com/api/docs/guides/realtime-conversations',
  voices: openaiVoiceNames.map(name => ({ name, recommended: name === 'marin' || name === 'cedar' })),
};
// MiniMax voices are account assets, not presets: a cloned voice works only with keys of the account that made it.
// nijiVoiceRefA01 came over from gen-video (2026-10-14); its existence was confirmed with the free get_voice API.
// Procedure, billing and source material: MINIMAX.md.
export const minimaxVoiceProfiles = {
  checkedAt: '2026-10-14',
  source: 'https://platform.minimax.io/docs/api-reference/speech-t2a-http',
  voices: [
    { name: 'nijiVoiceRefA01', clone: true, createdAt: '2026-08-12', description: '日本語の朗読音源（約19秒）から作ったクローンボイス。喋り方は冒頭5秒から学習。' },
  ],
};
const minimaxVoiceNames = minimaxVoiceProfiles.voices.map(v => v.name);
export const catalog = {
  checkedAt: '2026-10-11',
  tts: {
    models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'speech-2.8-hd', 'speech-2.8-turbo'],
    providers: { 'gemini-3.8-flash-tts': 'google', 'gemini-3.8-flash-lite-tts': 'google', 'speech-2.8-hd': 'minimax', 'speech-2.8-turbo': 'minimax' },
    voices: [...voiceNames],
    voicesByProvider: { google: [...voiceNames], minimax: [...minimaxVoiceNames] },
    defaultVoice: 'Kore',
    defaultVoiceByProvider: { google: 'Kore', minimax: 'nijiVoiceRefA01' },
    source: 'https://ai.google.dev/gemini-api/docs/speech-generation',
    status: '公式掲載のプリセット30声。実API・日本語の声質は未検証。',
    statusByModel: {
      'speech-2.8-hd': 'MiniMax T2A（高品質）。クローンボイスで読み上げる。読み方の文章指示は受け付けません。ラボからの実生成は未検証（gen-video で 2026-08-12 に生成実績あり）。',
      'speech-2.8-turbo': 'MiniMax T2A（低価格・速い）。クローンボイスで読み上げる。読み方の文章指示は受け付けません。実生成は未検証。',
    },
  },
  live: {
    models: ['gemini-3.8-live', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'gpt-live-1'],
    providers: { 'gemini-3.8-live': 'google', 'gpt-realtime-2.1': 'openai', 'gpt-realtime-2.1-mini': 'openai', 'gpt-live-1': 'openai-live' },
    // GPT-Live hands deeper reasoning to a backend model (Responses delegation). Docs: start with gpt-6-luna, gpt-6-sol for harder work.
    delegates: ['gpt-6-luna', 'gpt-6-sol'],
    // 公式：native audio出力モデルはTTSの全プリセット声に対応。
    voices: [...voiceNames],
    voicesByProvider: { google: [...voiceNames], openai: [...openaiVoiceNames], 'openai-live': [...gptLiveVoiceNames] },
    // Live default is Aoede in both the model lab and the studio (2026-10-12, user's choice). TTS stays Kore.
    defaultVoice: 'Aoede',
    defaultVoiceByProvider: { google: 'Aoede', openai: 'marin', 'openai-live': 'marin' },
    source: 'https://ai.google.dev/gemini-api/docs/live-api/capabilities#change-voice-and-language',
    status: 'gemini-3.8-live / Koreは1回の接続と最初の音声チャンク受信を確認。マイク会話・声質・他の声は未検証。TTSとの同一声質は保証しません。',
    // Official per-session limits (checked 2026-10-12). The app's own limit is only a spending guard;
    // minutes: null means the provider publishes no fixed cap (or the app lifts it by official means).
    sessionLimits: {
      'gemini-3.8-live': { minutes: null, official: '圧縮なしの音声セッションは15分、1本の接続は約10分で終了', handling: '本アプリは文脈圧縮とセッション再開（どちらも公式の手段）で接続を継ぎ直し、設定した上限まで会話を続けます。継ぎ直しの瞬間は数百ミリ秒の音声が落ちることがあります。', source: 'https://ai.google.dev/gemini-api/docs/live-api/session-management' },
      'gpt-realtime-2.1': { minutes: 60, official: '1セッション最大60分', handling: '60分で OpenAI 側が接続を終えます。続きは新しい会話として始めてください。', source: 'https://developers.openai.com/api/docs/guides/realtime-conversations' },
      'gpt-realtime-2.1-mini': { minutes: 60, official: '1セッション最大60分', handling: '60分で OpenAI 側が接続を終えます。続きは新しい会話として始めてください。', source: 'https://developers.openai.com/api/docs/guides/realtime-conversations' },
      'gpt-live-1': { minutes: null, unknown: true, official: '上限に達すると expired で終了。分数は公開されていません', handling: '終了理由を記録します。実測で分かった時間はここに追記します。', source: 'https://developers.openai.com/api/docs/guides/live-conversations' },
    },
    statusByModel: {
      'gemini-3.8-live': 'Google Gemini Live。マイク会話は動作確認済み。声質の評価は未実施。',
      'gpt-realtime-2.1': 'OpenAI Realtime（gpt-realtime-2.1）。実接続は未検証。',
      'gpt-realtime-2.1-mini': 'OpenAI Realtime（gpt-realtime-2.1-mini、低価格版）。実接続は未検証。',
      'gpt-live-1': 'OpenAI GPT-Live。会話は gpt-live-1、深い推論は委任先のモデルが担当。聞きながら話す全二重のため「会話の区切り」は自然会話のみ。実会話は未検証。',
    },
  },
};
import { validateStudio } from './studio.mjs';
export const sampleText = 'こんにちは、カンバセーションラボです。同じ言葉でも、声と間の取り方で印象は変わります。今日は、日本語の自然さと聞き取りやすさを比べてみましょう。';
export function validate(kind, body) {
  const c = catalog[kind];
  const provider = c?.providers?.[body.model] || 'google';
  const voices = c?.voicesByProvider?.[provider] || c?.voices || [];
  if (!c || !c.models.includes(body.model) || !voices.includes(body.voice)) throw new Error('Invalid model or voice');
  const condition = typeof body.condition === 'string' ? body.condition.trim() : '';
  // Studio instructions are built from several settings and run longer than a lab condition.
  if (condition.length > (body.studio ? 12000 : 1000)) throw new Error('Condition is too long');
  // MiniMax T2A has no free-text style field, so a condition would be stored but never applied.
  const result = { provider, model: body.model, voice: body.voice, condition: provider === 'minimax' ? '' : condition };
  if (kind === 'tts') {
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1500) throw new Error('Text must contain 1–1500 characters');
    result.text = body.text.trim();
  } else {
    if (!Number.isInteger(body.seconds) || body.seconds < 15 || body.seconds > 5400) throw new Error('Session limit must be 15–5400 seconds');
    result.seconds = body.seconds;
    if (!['automatic', 'manual'].includes(body.mode)) throw new Error('Invalid turn mode');
    result.mode = body.mode;
    if (body.opening !== undefined) { if (typeof body.opening !== 'string' || body.opening.length > 2000) throw new Error('Invalid opening'); result.opening = body.opening.trim(); }
    if (body.studio !== undefined) result.studio = validateStudio(body.studio);
    if (provider === 'openai-live') {
      if (body.mode !== 'automatic') throw new Error('GPT-Live is full duplex; manual turns are not supported');
      const delegate = body.delegate ?? c.delegates[0];
      if (!c.delegates.includes(delegate)) throw new Error('Invalid delegate model');
      result.delegate = delegate;
    }
  }
  return result;
}
