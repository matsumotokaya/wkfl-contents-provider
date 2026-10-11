export const catalog = {
  checkedAt: '2026-10-11',
  tts: {
    models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
    voices: ['Kore', 'Puck', 'Charon', 'Aoede'],
    source: 'https://ai.google.dev/gemini-api/docs/speech-generation',
    status: '公式掲載のプリセット。実API・日本語の声質は未検証。',
  },
  live: {
    models: ['gemini-3.8-live'],
    voices: ['Kore', 'Puck', 'Charon', 'Aoede'],
    source: 'https://ai.google.dev/gemini-api/docs/live-api/capabilities#change-voice-and-language',
    status: '公式Liveガイドの対応記載に基づく候補。モデル別の接続・声質は未検証。TTSとの同一声質は保証しません。',
  },
};
export const sampleText = 'こんにちは、WKFLです。同じ言葉でも、声と間の取り方で印象は変わります。今日は、日本語の自然さと聞き取りやすさを比べてみましょう。';
export function validate(kind, body) {
  const c = catalog[kind];
  if (!c || !c.models.includes(body.model) || !c.voices.includes(body.voice)) throw new Error('Invalid model or voice');
  const condition = typeof body.condition === 'string' ? body.condition.trim() : '';
  if (condition.length > 1000) throw new Error('Condition is too long');
  const result = { provider: 'google', model: body.model, voice: body.voice, condition };
  if (kind === 'tts') {
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1500) throw new Error('Text must contain 1–1500 characters');
    result.text = body.text.trim();
  } else {
    if (!Number.isInteger(body.seconds) || body.seconds < 15 || body.seconds > 180) throw new Error('Session limit must be 15–180 seconds');
    result.seconds = body.seconds;
    if (!['automatic', 'manual'].includes(body.mode)) throw new Error('Invalid turn mode');
    result.mode = body.mode;
  }
  return result;
}
