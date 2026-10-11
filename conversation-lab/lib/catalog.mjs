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
export const catalog = {
  checkedAt: '2026-10-11',
  tts: {
    models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
    voices: [...voiceNames],
    defaultVoice: 'Kore',
    source: 'https://ai.google.dev/gemini-api/docs/speech-generation',
    status: '公式掲載のプリセット30声。実API・日本語の声質は未検証。',
  },
  live: {
    models: ['gemini-3.8-live', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'gpt-live-1'],
    providers: { 'gemini-3.8-live': 'google', 'gpt-realtime-2.1': 'openai', 'gpt-realtime-2.1-mini': 'openai', 'gpt-live-1': 'openai-live' },
    // GPT-Live hands deeper reasoning to a backend model (Responses delegation). Docs: start with gpt-6-luna, gpt-6-sol for harder work.
    delegates: ['gpt-6-luna', 'gpt-6-sol'],
    // 公式：native audio出力モデルはTTSの全プリセット声に対応。
    voices: [...voiceNames],
    voicesByProvider: { google: [...voiceNames], openai: [...openaiVoiceNames], 'openai-live': [...gptLiveVoiceNames] },
    defaultVoice: 'Kore',
    defaultVoiceByProvider: { google: 'Kore', openai: 'marin', 'openai-live': 'marin' },
    source: 'https://ai.google.dev/gemini-api/docs/live-api/capabilities#change-voice-and-language',
    status: 'gemini-3.8-live / Koreは1回の接続と最初の音声チャンク受信を確認。マイク会話・声質・他の声は未検証。TTSとの同一声質は保証しません。',
    statusByModel: {
      'gemini-3.8-live': 'Google Gemini Live。マイク会話は動作確認済み。声質の評価は未実施。',
      'gpt-realtime-2.1': 'OpenAI Realtime（gpt-realtime-2.1）。実接続は未検証。',
      'gpt-realtime-2.1-mini': 'OpenAI Realtime（gpt-realtime-2.1-mini、低価格版）。実接続は未検証。',
      'gpt-live-1': 'OpenAI GPT-Live。会話は gpt-live-1、深い推論は委任先のモデルが担当。聞きながら話す全二重のため「会話の区切り」は自然会話のみ。実会話は未検証。',
    },
  },
};
export const sampleText = 'こんにちは、カンバセーションラボです。同じ言葉でも、声と間の取り方で印象は変わります。今日は、日本語の自然さと聞き取りやすさを比べてみましょう。';
export function validate(kind, body) {
  const c = catalog[kind];
  const provider = c?.providers?.[body.model] || 'google';
  const voices = c?.voicesByProvider?.[provider] || c?.voices || [];
  if (!c || !c.models.includes(body.model) || !voices.includes(body.voice)) throw new Error('Invalid model or voice');
  const condition = typeof body.condition === 'string' ? body.condition.trim() : '';
  if (condition.length > 1000) throw new Error('Condition is too long');
  const result = { provider, model: body.model, voice: body.voice, condition };
  if (kind === 'tts') {
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1500) throw new Error('Text must contain 1–1500 characters');
    result.text = body.text.trim();
  } else {
    if (!Number.isInteger(body.seconds) || body.seconds < 15 || body.seconds > 180) throw new Error('Session limit must be 15–180 seconds');
    result.seconds = body.seconds;
    if (!['automatic', 'manual'].includes(body.mode)) throw new Error('Invalid turn mode');
    result.mode = body.mode;
    if (provider === 'openai-live') {
      if (body.mode !== 'automatic') throw new Error('GPT-Live is full duplex; manual turns are not supported');
      const delegate = body.delegate ?? c.delegates[0];
      if (!c.delegates.includes(delegate)) throw new Error('Invalid delegate model');
      result.delegate = delegate;
    }
  }
  return result;
}
