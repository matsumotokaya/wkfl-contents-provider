// Copyable code for each voice. lib/google.mjs builds its real requests from the same functions,
// so the published code is exactly what this app sends. Pure module: used by the server and the browser.
export const snippetDocs = {
  live: 'https://ai.google.dev/gemini-api/docs/live-api/capabilities#change-voice-and-language',
  tts: 'https://ai.google.dev/gemini-api/docs/speech-generation',
  realtime: 'https://developers.openai.com/api/docs/guides/realtime-conversations',
};
export function liveVoiceSetup({ model, voice, instruction }) {
  return {
    model: `models/${model}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    systemInstruction: { parts: [{ text: instruction }] },
  };
}
export function ttsBody({ model, voice, text, style }) {
  return {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
    response_format: { type: 'audio', mime_type: 'audio/wav' },
    generation_config: { speech_config: [{ voice }] },
    store: false,
  };
}
const genders = { female: '女性', male: '男性', neutral: 'ニュートラル' };
export function voiceSnippets(profile, { liveModel, ttsModel, text, style, instruction, checkedAt }) {
  const voice = profile.name;
  const prompt = [
    `Google Gemini のプリセット音声「${voice}」を使って実装してください。`,
    `- 声: ${voice}（${genders[profile.gender] || '性別不明'}・公式の特徴: ${profile.style} / ${profile.styleJa}）`,
    `- リアルタイム会話: Gemini Live API（モデル ${liveModel}）。WebSocket の setup メッセージで generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName を "${voice}" にする。`,
    `- 読み上げ: Gemini TTS（モデル ${ttsModel}、Interactions API）。generation_config.speech_config を [{"voice": "${voice}"}] にし、読み方は speech_metadata.style で指示する。`,
    '- 声の名前で決まるのは声質まで。話し方や性格は Live では system instruction、TTS では style で指示する。',
    '- 言語はモデルが自動で判定する。話す言語を固定したい場合は指示文に書く。',
    `- 実装前に公式資料で仕様を確認する: ${snippetDocs.live} / ${snippetDocs.tts}`,
    `（WKFL Conversation Lab 声カタログ・${checkedAt}確認）`,
  ].join('\n');
  return [
    { id: 'prompt', label: 'AIへの指示（Claude Code などに貼る）', text: prompt },
    { id: 'live', label: `Live API の setup（${liveModel}）`, text: JSON.stringify({ setup: liveVoiceSetup({ model: liveModel, voice, instruction }) }, null, 2) },
    { id: 'tts', label: `TTS API のリクエスト（${ttsModel}）`, text: JSON.stringify(ttsBody({ model: ttsModel, voice, text, style }), null, 2) },
  ];
}

// OpenAI Realtime session config; lib/openai.mjs sends exactly this.
export const realtimeTranscriptionModel = 'gpt-4o-mini-transcribe';
export function realtimeSessionUpdate(settings) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: settings.studio ? `日本語で自然に話してください。\n\n${settings.condition}` : `日本語で短く自然に対話してください。${settings.condition}`,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: realtimeTranscriptionModel, language: 'ja' },
          turn_detection: settings.mode === 'manual' ? null : { type: 'semantic_vad' },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: settings.voice },
      },
    },
  };
}
export function openaiVoiceSnippets(profile, { model, condition = '', checkedAt }) {
  const voice = profile.name;
  const prompt = [
    `OpenAI Realtime API のボイス「${voice}」を使って実装してください。`,
    `- モデル: ${model}。接続: wss://api.openai.com/v1/realtime?model=${model}（Authorization: Bearer <APIキー>。キーはサーバー側に置く）`,
    `- 接続後に session.update を送り、session.audio.output.voice を "${voice}" にする。音声は入出力とも audio/pcm 24kHz（PCM16 モノラル）。`,
    '- マイク音声は input_audio_buffer.append（base64）で送り、応答音声は response.output_audio.delta で受け取る。',
    '- 声はモデルが一度音声で応答すると、そのセッション中は変更できない。話し方や性格は instructions で指示する。',
    `- 実装前に公式資料で仕様を確認する: ${snippetDocs.realtime}`,
    `（WKFL Conversation Lab 声カタログ・${checkedAt}確認）`,
  ].join('\n');
  return [
    { id: 'prompt', label: 'AIへの指示（Claude Code などに貼る）', text: prompt },
    { id: 'realtime', label: `Realtime の session.update（${model}）`, text: JSON.stringify(realtimeSessionUpdate({ voice, condition, mode: 'automatic' }), null, 2) },
  ];
}

// GPT-Live session start; lib/openai-live.mjs sends exactly this. Prompt structure follows
// https://developers.openai.com/api/docs/guides/live-prompting (checked 2026-10-12).
export const gptLiveDelegates = ['gpt-6-luna', 'gpt-6-sol'];
export function liveSessionStart({ voice, condition = '', delegate = 'gpt-6-luna', studio }) {
  return {
    type: 'session.start',
    session: {
      model: 'gpt-live-1',
      instructions: [
        // In the studio the role comes from the show settings, so the lab's default role is left out.
        `${studio ? '' : 'あなたは日本語で話す議論の相手です。'}温かく自然に、落ち着いたペースで、はっきり話してください。ユーザーが別の言語を求めない限り日本語で話します。`,
        '次のときはバックエンドに委任してください：考えを深める必要がある問い、反論や論点の整理、事実の確認が必要な話題。',
        '次のときは委任しないでください：会話の流れや届いている結果だけで答えられるとき、短い確認や相づち。',
        '委任した結果が届く前に答えを推測しないでください。待つ間は、考えていることを短く伝えてかまいません。',
        condition,
      ].filter(Boolean).join('\n'),
      audio: { output: { voice } },
      delegation: {
        type: 'responses',
        responses: {
          model: delegate,
          instructions: 'あなたは音声会話の裏側で考える役です。議論を深めるために、論点・根拠・反論を日本語で簡潔にまとめてください。話し言葉で伝えやすい長さにしてください。',
          reasoning: { effort: 'medium' },
        },
      },
    },
  };
}
export function gptLiveVoiceSnippets(profile, { delegate = 'gpt-6-luna', checkedAt }) {
  const voice = profile.name;
  const prompt = [
    `OpenAI GPT-Live（gpt-live-1）でボイス「${voice}」を使って実装してください。`,
    '- 接続: wss://api.openai.com/v1/live/sessions（Authorization: Bearer <APIキー>。キーはサーバー側に置く）',
    `- 最初に session.start を送り、session.audio.output.voice を "${voice}" にする。声は開始後に変えられない。音声は入出力とも 24kHz の PCM16 モノラル（base64）。`,
    '- マイク音声は session.input_audio.append で送り、応答音声は session.output_audio.delta、文字起こしは session.input_transcript.delta / session.output_transcript.delta で受け取る。',
    `- 深い推論は delegation（type: "responses"、model: "${delegate}"）に任せる。いつ委任するかは instructions に書く。`,
    '- 料金は音声が1分$0.05（秒単位）で、委任先のモデルの利用料は別。',
    '- 実装前に公式資料で仕様を確認する: https://developers.openai.com/api/docs/guides/live',
    `（WKFL Conversation Lab 声カタログ・${checkedAt}確認）`,
  ].join('\n');
  return [
    { id: 'prompt', label: 'AIへの指示（Claude Code などに貼る）', text: prompt },
    { id: 'gpt-live', label: `GPT-Live の session.start（委任先 ${delegate}）`, text: JSON.stringify(liveSessionStart({ voice, delegate }), null, 2) },
  ];
}
