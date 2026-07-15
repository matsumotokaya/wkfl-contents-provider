import { useState, useRef, ChangeEvent } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  Volume2, 
  Play, 
  Pause, 
  RotateCcw, 
  Settings2, 
  History, 
  Trash2, 
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Download,
  Music,
  Upload,
  X,
  Sparkles,
  Scissors
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

// Available voices for Gemini TTS
const VOICES = [
  { 
    id: 'Charon', 
    name: 'Charon (シャロン)', 
    gender: '男性',
    aspect: '深みのある低音・威厳',
    description: '深みと威厳のある落ち着いた大柄な男性の声。ドキュメンタリー、解説、辛口評論などに適しています。' 
  },
  { 
    id: 'Kore', 
    name: 'Kore (コレ)', 
    gender: '女性',
    aspect: 'クリア・知的・プロフェッショナル',
    description: '知的でクリアな聞き取りやすい女性の声。ニュース、ビジネスプレゼン、冷静な要約に適しています。' 
  },
  { 
    id: 'Puck', 
    name: 'Puck (パック)', 
    gender: '男性',
    aspect: '明るい・親しみ・温かみ',
    description: '明るく温かみがあり、親しみやすい若い男性の声。日常会話、カジュアルなトークに向いています。' 
  },
  { 
    id: 'Fenrir', 
    name: 'Fenrir (フェンリル)', 
    gender: '男性',
    aspect: '穏やか・静か・落ち着き',
    description: '穏やかで静かな落ち着いた男性の声。朗読、ゆったりした対話に適しています。' 
  },
  { 
    id: 'Zephyr', 
    name: 'Zephyr (ゼピュロス)', 
    gender: '女性',
    aspect: '柔らかい・優しい・癒やし',
    description: '細やかで非常に柔らかく優しい女性の声。癒やし系コンテンツ、穏やかな物語の朗読に適しています。' 
  },
  { 
    id: 'Aoede', 
    name: 'Aoede (アオイデ)', 
    gender: '女性',
    aspect: '表現力豊か・ドラマチック',
    description: '感情豊かでドラマチックな表現力を持つ女性の声。ストーリー性の高いナレーションや朗読に適しています。' 
  }
];

const PERSONA_PRESETS = [
  {
    id: 'news',
    name: 'ニュースアナウンサー',
    text: '明るく落ち着いたニュースアナウンサー、感情を込めて説明します。'
  },
  {
    id: 'critic',
    name: 'ブラックな批評家',
    text: 'テンポよく論理的に語る。ブラックなユーモアのある批評家。'
  },
  {
    id: 'youtuber',
    name: 'Youtube配信者',
    text: 'フレンドリーで、ユーモアのあるYoutube配信者。'
  },
  {
    id: 'custom',
    name: 'カスタム（フリー入力）',
    text: ''
  }
];

interface TTSHistoryItem {
  id: string;
  text: string;
  voice: string;
  timestamp: number;
  audioData?: string;
}

interface ParsedSectionInfo {
  type: 'intro' | 'topic_label' | 'caption' | 'outro' | 'normal';
  text: string;
  label?: string;
  topic?: string;
}

interface DiagnosticLog {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  details?: string;
}

const parseSectionText = (rawText: string): ParsedSectionInfo => {
  const text = rawText.trim();
  
  const introMatch = text.match(/^\[INTRO\]\s*([\s\S]*)$/i);
  if (introMatch) {
    return {
      type: 'intro',
      text: introMatch[1].trim()
    };
  }
  
  const captionMatch = text.match(/^\[CAPTION\]\s*([\s\S]*)$/i);
  if (captionMatch) {
    return {
      type: 'caption',
      text: captionMatch[1].trim()
    };
  }
  
  const outroMatch = text.match(/^\[OUTRO\]\s*([\s\S]*)$/i);
  if (outroMatch) {
    return {
      type: 'outro',
      text: outroMatch[1].trim()
    };
  }
  
  const topicLabelMatch = text.match(/^\[TOPIC_LABEL\|([^|]*)\|([^\]]*)\](?:\s*([\s\S]*))?$/i);
  if (topicLabelMatch) {
    const label = topicLabelMatch[1].trim();
    const topic = topicLabelMatch[2].trim();
    const rest = (topicLabelMatch[3] || '').trim();
    return {
      type: 'topic_label',
      label,
      topic,
      text: rest || `${label}。 ${topic}。`
    };
  }

  // Support custom script IDs like [s1] or s1:, s2., etc.
  const customTagMatch = text.match(/^(?:\[(s\d+)\]|(s\d+)[:.\s・、]+)\s*([\s\S]*)$/i);
  if (customTagMatch) {
    const id = customTagMatch[1] || customTagMatch[2]; // e.g., "s1"
    const content = customTagMatch[3].trim();
    return {
      type: 'normal',
      text: content,
      label: id
    };
  }
  
  return {
    type: 'normal',
    text: text
  };
};

const hasTags = (text: string): boolean => {
  return /\[(INTRO|TOPIC_LABEL|CAPTION|OUTRO)/i.test(text) || /^(?:\[s\d+\]|s\d+[:.\s・、])/i.test(text.trim()) || /\ns\d+[:.\s・、]/i.test(text);
};

const matchesMultipleTags = (text: string): boolean => {
  const matches = text.match(/(?:^|\n)\s*(?:\[s\d+\]|s\d+[:.\s・、]+)/gi);
  return matches ? matches.length > 1 : false;
};

const splitDraftByTags = (text: string): string[] => {
  const segments: string[] = [];
  const lines = text.split('\n');
  let currentSegment = '';
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    const isTagStart = /^\[(INTRO|TOPIC_LABEL|CAPTION|OUTRO)/i.test(trimmedLine) || 
                       /^(?:\[s\d+\]|s\d+[:.\s・、]+)/i.test(trimmedLine);
                       
    if (isTagStart) {
      if (currentSegment.trim()) {
        segments.push(currentSegment.trim());
      }
      currentSegment = line;
    } else {
      if (currentSegment) {
        currentSegment += '\n' + line;
      } else if (trimmedLine) {
        currentSegment = line;
      }
    }
  }
  
  if (currentSegment.trim()) {
    segments.push(currentSegment.trim());
  }
  
  return segments;
};

export default function App() {
  const [sections, setSections] = useState<string[]>(['', '', '']);
  const [sectionAudios, setSectionAudios] = useState<(string | null)[]>([null, null, null]);
  const [draft, setDraft] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('エピソードタイトル');
  const [isSplitting, setIsSplitting] = useState(false);
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.8);
  const [selectedVoice, setSelectedVoice] = useState('Charon');
  const [persona, setPersona] = useState('明るく落ち着いたニュースアナウンサー、感情を込めて説明します。');
  const [selectedPersonaPreset, setSelectedPersonaPreset] = useState('news');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TTSHistoryItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{ current: number, total: number } | null>(null);
  
  // Real-time operations and diagnostics logging system
  const [logs, setLogs] = useState<DiagnosticLog[]>([
    {
      id: 'init',
      timestamp: Date.now(),
      type: 'info',
      message: 'システムが初期化されました。音声生成・BGMミキシングの準備が完了しています。',
      details: '台本を入力して「セクションに分割」し、準備が整ったら「すべての音声を生成」を押してください。'
    }
  ]);
  const [skipExistingGeneration, setSkipExistingGeneration] = useState(true);
  const [autoCombineAfterGen, setAutoCombineAfterGen] = useState(false);

  const addLog = (type: 'info' | 'success' | 'error' | 'warning', message: string, details?: string) => {
    const newLog: DiagnosticLog = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      message,
      details
    };
    setLogs(prev => [newLog, ...prev]);
  };
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const addSection = () => {
    setSections(prev => [...prev, '']);
    setSectionAudios(prev => [...prev, null]);
  };

  const removeSection = (index: number) => {
    if (sections.length <= 1) return;
    setSections(prev => prev.filter((_, i) => i !== index));
    setSectionAudios(prev => prev.filter((_, i) => i !== index));
  };

  // Initialize AudioContext on first user interaction
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const playAudio = async (id: string, base64Data: string, rawText?: string) => {
    initAudioContext();
    const ctx = audioContextRef.current!;
    
    // Check if clicking currently playing audio to stop it
    if (playingId === id && isPlaying) {
      stopPlayback();
      return;
    }

    // Stop any current playback
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
    }

    try {
      setIsPlaying(true);
      setPlayingId(id);
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      let audioBuffer;
      try {
        // Try decoding as a full audio file (WAV/MP3)
        audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      } catch (e) {
        // Fallback to raw PCM 24kHz if decoding fails
        // Ensure even byte length for Int16Array
        const evenLength = bytes.length - (bytes.length % 2);
        const int16Data = new Int16Array(bytes.buffer, 0, evenLength / 2);
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
          float32Data[i] = int16Data[i] / 32768.0;
        }
        audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);
      }

      if (rawText) {
        const parsed = parseSectionText(rawText);
        const utterances = parseTextIntoUtterances(rawText, parsed.type);
        audioBuffer = injectIntervalsToAudioBuffer(ctx, audioBuffer, utterances);
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      
      source.onended = () => {
        setIsPlaying(false);
        setPlayingId(null);
        currentSourceRef.current = null;
      };

      currentSourceRef.current = source;
      source.start();
    } catch (err) {
      console.error('Error playing audio:', err);
      setError('Failed to play audio');
      setIsPlaying(false);
      setPlayingId(null);
    }
  };

  const handleGenerateSection = async (index: number) => {
    const textToGen = sections[index].trim();
    if (!textToGen) return;
    
    setIsGenerating(true);
    setActiveSectionIndex(index);
    setError(null);
    addLog('info', `セクション ${index + 1} の音声生成を開始します... (声: ${selectedVoice})`);
    
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('API Key is missing. Please configuration environment instructions.');
      }

      const ai = new GoogleGenAI({ apiKey });
      
      if (textToGen.length > 2000) {
        throw new Error(`Section ${index + 1} is too long (> 2,000 chars).`);
      }

      const parsed = parseSectionText(textToGen);
      const utterances = parseTextIntoUtterances(textToGen, parsed.type);
      const cleanText = utterances
        .filter(u => u.type === 'speech')
        .map(u => u.text)
        .join('\n');

      const prompt = persona 
        ? `Please read the following text in a "${persona}" custom character tone. Do not write or speak any introductory greetings, confirmations, or chat responses. Immediately start reading the exact text, and outputs ONLY the spoken audio (no text output allowed at all): "${cleanText}"`
        : `Say this exact text and output ONLY the spoken audio, do not include any text responses: "${cleanText}"`;

      let response;
      let retryCount = 0;
      const maxRetries = 1;

      while (retryCount <= maxRetries) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: prompt,
            config: {
              responseModalities: ['AUDIO' as any],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { 
                    voiceName: selectedVoice
                  },
                },
              },
            },
          });
          break; // Success
        } catch (e: any) {
          if (retryCount === maxRetries) throw e;
          retryCount++;
          addLog('warning', `セクション ${index + 1} の生成を再試行します (${retryCount}/${maxRetries + 1})`, e.message);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!response) throw new Error('Failed to get a response after retries.');

      const candidate = response.candidates?.[0];
      if (!candidate) {
        throw new Error('No response from the model. The content might have been blocked.');
      }

      const base64Audio = candidate.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        setSectionAudios(prev => {
          const newAudios = [...prev];
          newAudios[index] = base64Audio;
          return newAudios;
        });

        const newItem: TTSHistoryItem = {
          id: crypto.randomUUID(),
          text: textToGen,
          voice: selectedVoice,
          timestamp: Date.now(),
          audioData: base64Audio
        };
        setHistory(prev => [newItem, ...prev].slice(0, 10));
        addLog('success', `セクション ${index + 1} の音声生成に成功しました。`, `声: ${selectedVoice}, テキスト長: ${cleanText.length}文字`);
      } else {
        throw new Error('No audio data received.');
      }
    } catch (err: any) {
      console.error(`Error in Section ${index + 1}:`, err);
      let errorMessage = err.message || 'Unknown error';
      try {
        // Try to parse JSON error if it's from the API
        const parsed = JSON.parse(err.message);
        if (parsed.error?.message) errorMessage = parsed.error.message;
      } catch (e) {
        // Not JSON, use original message
      }
      setError(`Section ${index + 1}: ${errorMessage}`);
      addLog('error', `セクション ${index + 1} の生成中にエラーが発生しました。`, errorMessage);
    } finally {
      setIsGenerating(false);
      setActiveSectionIndex(null);
    }
  };

  const handleGenerateAll = async () => {
    const activeSections = sections.map((s, i) => ({ text: s.trim(), index: i })).filter(s => s.text.length > 0);
    if (activeSections.length === 0) {
      addLog('warning', '生成可能なテキストが含まれているセクションがありません。');
      return;
    }
    
    const targetSections = skipExistingGeneration 
      ? activeSections.filter(s => !sectionAudios[s.index])
      : activeSections;

    if (targetSections.length === 0) {
      addLog('info', 'すべてのセクションはすでに生成完了状態（オーディオ有り）です。新規生成をスキップしました。', '結合ボタンを押すか、自動生成結合を有効にしてください。');
      if (autoCombineAfterGen) {
        addLog('info', '「自動的に結合してダウンロード」が有効なため、即時に音声結合を開始します。');
        setTimeout(() => {
          if (bgmFile) {
            mixAndDownload();
          } else {
            combineAndDownload();
          }
        }, 150);
      }
      return;
    }

    setIsGenerating(true);
    setError(null);
    addLog('info', `一括TTS生成プロセスを開始します。対象: ${targetSections.length}セクション (生成済みスキップ: ${skipExistingGeneration ? 'オン' : 'オフ'})`);
    
    const currentAudios = [...sectionAudios];
    let hasFailed = false;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('API Key is missing. Please ensure it is set in the environment.');
      }

      const ai = new GoogleGenAI({ apiKey });

      for (const section of targetSections) {
        setActiveSectionIndex(section.index);
        setError(null);
        addLog('info', `セクション ${section.index + 1} の音声データを生成中... (${section.text.length}文字)`);
        
        if (section.text.length > 2000) {
          throw new Error(`Section ${section.index + 1} is too long. Please limit to 2,000 characters for quality.`);
        }

        try {
          const parsed = parseSectionText(section.text);
          const utterances = parseTextIntoUtterances(section.text, parsed.type);
          const cleanText = utterances
            .filter(u => u.type === 'speech')
            .map(u => u.text)
            .join('\n');

          const prompt = persona 
            ? `Please read the following text in a "${persona}" custom character tone. Do not write or speak any introductory greetings, confirmations, or chat responses. Immediately start reading the exact text, and outputs ONLY the spoken audio (no text output allowed at all): "${cleanText}"`
            : `Say this exact text and output ONLY the spoken audio, do not include any text responses: "${cleanText}"`;

          let response;
          let retryCount = 0;
          const maxRetries = 1;

          while (retryCount <= maxRetries) {
            try {
              response = await ai.models.generateContent({
                model: "gemini-3.1-flash-tts-preview",
                contents: prompt,
                config: {
                  responseModalities: ['AUDIO' as any],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { 
                        voiceName: selectedVoice
                      },
                    },
                  },
                },
              });
              break;
            } catch (e: any) {
              if (retryCount === maxRetries) throw e;
              retryCount++;
              addLog('warning', `セクション ${section.index + 1} のリトライ中 (${retryCount}/${maxRetries + 1})`, e.message);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }

          if (!response) throw new Error('No response candidates.');

          const candidate = response.candidates?.[0];
          if (!candidate) {
            throw new Error(`Section ${section.index + 1}: No response candidates from Gemini API.`);
          }

          const base64Audio = candidate.content?.parts?.[0]?.inlineData?.data;
          
          if (base64Audio) {
            currentAudios[section.index] = base64Audio;
            setSectionAudios(prev => {
              const newAudios = [...prev];
              newAudios[section.index] = base64Audio;
              return newAudios;
            });

            const newItem: TTSHistoryItem = {
              id: crypto.randomUUID(),
              text: section.text,
              voice: selectedVoice,
              timestamp: Date.now(),
              audioData: base64Audio
            };
            
            setHistory(prev => [newItem, ...prev].slice(0, 10));
            addLog('success', `セクション ${section.index + 1} の音声データの生成に成功しました。`);
          } else {
            throw new Error(`Section ${section.index + 1}: No audio data received.`);
          }
        } catch (sectionErr: any) {
          hasFailed = true;
          console.error(`Error in section ${section.index + 1}:`, sectionErr);
          let errorMessage = sectionErr.message || 'Unknown error';
          try {
            const parsed = JSON.parse(sectionErr.message);
            if (parsed.error?.message) errorMessage = parsed.error.message;
          } catch (e) {}
          setError(`Error in Section ${section.index + 1}: ${errorMessage}`);
          addLog('error', `セクション ${section.index + 1} の生成中にエラーが検出され、プロセスが中断されました。`, errorMessage);
          break;
        }
      }
    } catch (err: any) {
      hasFailed = true;
      console.error('TTS Generation Error:', err);
      setError(err.message || 'Failed to generate speech.');
      addLog('error', '一括生成中に大域エラーが発生しました。', err.message);
    } finally {
      setIsGenerating(false);
      setActiveSectionIndex(null);
      if (!hasFailed) {
        addLog('success', 'すべての音声セグメントのTTS生成が完了しました！');
        if (autoCombineAfterGen) {
          addLog('info', '「自動的に結合してダウンロード」が有効なため、即、結合・マキシング処理を開始します。');
          setTimeout(() => {
            if (bgmFile) {
              mixAndDownload(currentAudios);
            } else {
              combineAndDownload(currentAudios);
            }
          }, 350);
        }
      }
    }
  };

  const updateSection = (index: number, value: string) => {
    const newSections = [...sections];
    newSections[index] = value;
    setSections(newSections);
    
    // Reset audio if text changes
    if (sectionAudios[index]) {
      const newAudios = [...sectionAudios];
      newAudios[index] = null;
      setSectionAudios(newAudios);
    }
  };

  const copySection = (index: number) => {
    navigator.clipboard.writeText(sections[index]);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const stopPlayback = () => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Ignore
      }
    }
    setIsPlaying(false);
    setPlayingId(null);
    currentSourceRef.current = null;
  };

  const clearHistory = () => {
    setHistory([]);
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearAllSections = () => {
    setSections(['', '', '']);
    setSectionAudios([null, null, null]);
    setDraft('');
    setError(null);
  };

  const handleSplitDraft = async () => {
    if (!draft.trim()) return;
    
    setIsSplitting(true);
    setError(null);
    addLog('info', '原稿のセクション自動分割を開始しました。');

    try {
      if (hasTags(draft)) {
        const parsedSegments = splitDraftByTags(draft);
        setSections(parsedSegments);
        setSectionAudios(new Array(parsedSegments.length).fill(null));
        setIsSplitting(false);
        addLog('success', 'タグ付けされたスクリプトを検出しました。', `タグ指定に基づいて ${parsedSegments.length} 個のセクションに自動分割しました。`);
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('API Key is missing.');

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `
        あなたはポッドキャストの編集ディレクターです。
        以下の「DRAFT」の文章を、ナレーション原稿として自然な区切りで、複数のセクションに分割してください。

        【ルール】
        1. 1つのセクションは最大1,200文字程度にすること。
        2. 文の途中で切らないように、句読点や話題の変わり目を確認すること。
        3. 出力は必ず以下のJSON形式のみで返してください。他の説明は不要です。
        
        {
          "sections": ["セクション1の文章", "セクション2の文章", ...]
        }

        【DRAFT】
        ${draft}
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });
      const responseText = result.text;
      if (!responseText) throw new Error('No response from AI.');
      
      // Extract JSON if model wraps it in markdown
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse AI response: No JSON found.');
      
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.sections || !Array.isArray(parsed.sections)) throw new Error('Invalid JSON format.');

      setSections(parsed.sections);
      setSectionAudios(new Array(parsed.sections.length).fill(null));
      addLog('success', 'AIによるセクション自動分割が完了しました。', `${parsed.sections.length} 個のセクションが作成されました。各ブロックを微調整できます。`);
    } catch (err: any) {
      console.error('Split Error:', err);
      setError('AIによる分配に失敗しました: ' + err.message);
      addLog('error', 'セクションの自動分割中にエラーが発生しました。', err.message);
    } finally {
      setIsSplitting(false);
    }
  };

  const handleBgmUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setBgmFile(file);
      setError(null);
      addLog('success', `BGMファイルをアップロードしました: ${file.name}`, `サイズ: ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
    } else if (file) {
      setError('Please upload an audio file (MP3, WAV, etc.) for BGM.');
      addLog('warning', 'BGMファイルの形式が無効です。MP3またはWAV形式などの有効な音声ファイルを選択してください。');
    }
  };

  const handleAudioUpload = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      addLog('info', `セクション ${index + 1} の手動音声ファイル読み込み中...`);
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const base64 = result.split(',')[1];
        setSectionAudios(prev => {
          const newAudios = [...prev];
          newAudios[index] = base64;
          return newAudios;
        });
        addLog('success', `セクション ${index + 1} の音声ファイルが正常にアップロードされました。`, file.name);
      };
      reader.readAsDataURL(file);
      setError(null);
    } else if (file) {
      setError('Please upload an audio file.');
      addLog('warning', '無効なファイルがアップロードされました。形式を確認してください。');
    }
  };

  const calculateUtteranceWeight = (text: string): number => {
    const charLength = text.length;
    const punctuationCount = (text.match(/[、,]/g) || []).length;
    const sentenceEndCount = (text.match(/[。！？!?]/g) || []).length;
    return (charLength * 300) + (punctuationCount * 300) + (sentenceEndCount * 600);
  };

  const parseTextIntoUtterances = (rawText: string, defaultType: string): { id?: string; text: string; weight: number; type: 'speech' | 'interval'; durationSec?: number }[] => {
    const parsed = parseSectionText(rawText);
    const contentText = parsed.text;
    
    const tagRegex = /(?:^|[\s\n]+)(?:\[(s\d+)\]|(s\d+)[:.\s・、]+)/ig;
    const intervalRegex = /\[interval:\s*(\d+(?:\.\d+)?)\s*s?\]/ig;
    
    interface MatchToken {
      type: 'tag' | 'interval';
      index: number;
      length: number;
      value: string;
    }
    
    const matches: MatchToken[] = [];
    let match;
    
    // Find narration tags
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(contentText)) !== null) {
      const id = (match[1] || match[2]).toLowerCase();
      matches.push({
        type: 'tag',
        index: match.index,
        length: match[0].length,
        value: id
      });
    }
    
    // Find interval tags
    intervalRegex.lastIndex = 0;
    while ((match = intervalRegex.exec(contentText)) !== null) {
      const sec = match[1];
      matches.push({
        type: 'interval',
        index: match.index,
        length: match[0].length,
        value: sec
      });
    }
    
    // Sort matches by their index
    matches.sort((a, b) => a.index - b.index);
    
    const result: { id?: string; text: string; weight: number; type: 'speech' | 'interval'; durationSec?: number }[] = [];
    
    if (matches.length > 0) {
      let lastIndex = 0;
      let activeTagId: string | undefined = undefined;
      
      for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        
        if (current.index > lastIndex) {
          const subText = contentText.substring(lastIndex, current.index).trim();
          if (subText) {
            result.push({
              id: activeTagId,
              text: subText,
              weight: calculateUtteranceWeight(subText),
              type: 'speech'
            });
          }
        }
        
        if (current.type === 'tag') {
          activeTagId = current.value;
        } else if (current.type === 'interval') {
          const durationSec = parseFloat(current.value);
          result.push({
            text: `[interval:${current.value}s]`,
            weight: 0,
            type: 'interval',
            durationSec: Math.max(0.1, durationSec)
          });
        }
        
        lastIndex = current.index + current.length;
      }
      
      if (lastIndex < contentText.length) {
        const subText = contentText.substring(lastIndex).trim();
        if (subText) {
          result.push({
            id: activeTagId,
            text: subText,
            weight: calculateUtteranceWeight(subText),
            type: 'speech'
          });
        }
      }
    } else {
      const sentences: string[] = [];
      let current = '';
      
      for (let i = 0; i < contentText.length; i++) {
        const char = contentText[i];
        current += char;
        if (/[。！？!?\n]/.test(char)) {
          const trimmed = current.trim();
          if (trimmed) {
            sentences.push(trimmed);
          }
          current = '';
        }
      }
      const finalTrimmed = current.trim();
      if (finalTrimmed) {
        sentences.push(finalTrimmed);
      }
      
      sentences.forEach(s => {
        let id: string | undefined = undefined;
        if (parsed.type === 'intro') {
          id = 'intro';
        } else if (parsed.type === 'outro') {
          id = 'outro';
        }
        
        result.push({
          id,
          text: s,
          weight: calculateUtteranceWeight(s),
          type: 'speech'
        });
      });
    }
    
    if (result.length === 0 && contentText.trim()) {
      let id: string | undefined = undefined;
      if (parsed.type === 'intro') {
        id = 'intro';
      } else if (parsed.type === 'outro') {
        id = 'outro';
      }
      result.push({
        id,
        text: contentText.trim(),
        weight: calculateUtteranceWeight(contentText.trim()),
        type: 'speech'
      });
    }
    
    return result;
  };

  const injectIntervalsToAudioBuffer = (
    ctx: BaseAudioContext,
    originalBuffer: AudioBuffer,
    utterances: { type: 'speech' | 'interval'; durationSec?: number; weight: number; text: string }[]
  ): AudioBuffer => {
    const hasIntervals = utterances.some(u => u.type === 'interval');
    if (!hasIntervals) {
      return originalBuffer;
    }

    const speechUtterances = utterances.filter(u => u.type === 'speech');
    const speechCount = speechUtterances.length;

    if (speechCount === 0) {
      return originalBuffer;
    }

    const totalWeight = speechUtterances.reduce((sum, u) => sum + u.weight, 0);
    const totalIntervalSec = utterances
      .filter(u => u.type === 'interval')
      .reduce((sum, u) => sum + (u.durationSec || 0), 0);
    
    const targetSampleRate = originalBuffer.sampleRate;
    const targetChannels = originalBuffer.numberOfChannels;
    const newLength = originalBuffer.length + Math.round(totalIntervalSec * targetSampleRate);
    
    const newBuffer = ctx.createBuffer(targetChannels, newLength, targetSampleRate);
    
    for (let ch = 0; ch < targetChannels; ch++) {
      const origData = originalBuffer.getChannelData(ch);
      const newData = newBuffer.getChannelData(ch);
      
      let origOffset = 0;
      let newOffset = 0;
      let currentSpeechIdx = 0;
      
      utterances.forEach((utt) => {
        if (utt.type === 'speech') {
          const fraction = totalWeight > 0 ? (utt.weight / totalWeight) : 0;
          let speechSamples = Math.round(originalBuffer.length * fraction);
          
          if (currentSpeechIdx === speechCount - 1) {
            speechSamples = originalBuffer.length - origOffset;
          }
          
          if (speechSamples > 0) {
            const samplesToCopy = Math.min(speechSamples, origData.length - origOffset, newData.length - newOffset);
            if (samplesToCopy > 0) {
              const chunk = origData.subarray(origOffset, origOffset + samplesToCopy);
              newData.set(chunk, newOffset);
              origOffset += samplesToCopy;
              newOffset += samplesToCopy;
            }
          }
          currentSpeechIdx++;
        } else if (utt.type === 'interval') {
          const intervalSamples = Math.round((utt.durationSec || 0) * targetSampleRate);
          newOffset += intervalSamples;
        }
      });
    }
    
    return newBuffer;
  };

  const generateAndDownloadTimingJson = (
    fileName: string,
    speechBuffers: AudioBuffer[],
    speechStartTimes: number[],
    totalDuration: number,
    activeSections: { text: string; idx: number }[]
  ) => {
    const allJsonSegments: { id: string; start_ms: number; text: string }[] = [];
    
    activeSections.forEach((item, idx) => {
      const sectionText = item.text;
      const sectionStartMs = Math.round(speechStartTimes[idx] * 1000);
      const buffer = speechBuffers[idx];
      const sectionDurationMs = buffer ? Math.round(buffer.duration * 1000) : 0;
      
      const parsed = parseSectionText(sectionText);
      const utterances = parseTextIntoUtterances(sectionText, parsed.type);
      
      // Determine base ID for this section matching user's original tags (s1, s2, intro, etc.)
      let baseId = `s${item.idx + 1}`;
      if (parsed.label && /^s\d+$/i.test(parsed.label)) {
        baseId = parsed.label.toLowerCase(); // Make sure it preserves 's1', 's2' structure
      } else if (parsed.type === 'intro') {
        baseId = 'intro';
      } else if (parsed.type === 'outro') {
        baseId = 'outro';
      }
      
      const totalIntervalMs = utterances
        .filter(u => u.type === 'interval')
        .reduce((sum, u) => sum + Math.round((u.durationSec || 0) * 1000), 0);
      
      const speechDurationMs = Math.max(0, sectionDurationMs - totalIntervalMs);
      const speechUtterances = utterances.filter(u => u.type === 'speech');
      const totalSpeechWeight = speechUtterances.reduce((sum, u) => sum + u.weight, 0);
      
      let currentOffsetMs = 0;
      utterances.forEach((utt, uIdx) => {
        if (utt.type === 'interval') {
          const intervalMs = Math.round((utt.durationSec || 0) * 1000);
          currentOffsetMs += intervalMs;
          return; // Skip adding interval elements to the timing JSON, but advance offset
        }
        
        const durationFraction = totalSpeechWeight > 0 ? (utt.weight / totalSpeechWeight) : 0;
        const utteranceDurationMs = Math.round(speechDurationMs * durationFraction);
        const startMs = sectionStartMs + currentOffsetMs;
        
        let finalId = utt.id;
        
        if (!finalId) {
          if (speechUtterances.length === 1) {
            finalId = baseId;
          } else {
            // Apply sub-IDs (branch numbers) like s2_1, s2_2, s2_3
            finalId = `${baseId}_${uIdx + 1}`;
          }
        }
        
        allJsonSegments.push({
          id: finalId,
          start_ms: startMs,
          text: utt.text
        });
        
        currentOffsetMs += utteranceDurationMs;
      });
    });
    
    const jsonString = JSON.stringify(allJsonSegments, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/\.[^/.]+$/, "") + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const mixAndDownload = async (customAudios?: (string | null)[]) => {
    const audiosToUse = customAudios || sectionAudios;
    
    // Check if there are some sections that have text but no audio yet
    const missingAudioSectionsCount = sections.filter((text, idx) => text.trim().length > 0 && !audiosToUse[idx]).length;
    if (missingAudioSectionsCount > 0) {
      addLog('warning', `警告: テキストが存在するが音声が未生成のセクションが ${missingAudioSectionsCount} 件見つかりました。これらのセクションは今回の出力およびタイミングJSONから除外されます。すべてを盛り込むには「すべての音声を生成」を行ってください！`);
    }

    const validAudios = audiosToUse.filter((a): a is string => a !== null);
    if (validAudios.length === 0) {
      addLog('warning', 'ミキシング可能な音声パーツがありません。まず音声を生成してください。');
      return;
    }

    setIsGenerating(true);
    setError(null);
    addLog('info', 'BGMミキシング・音声レンダリングを開始します...', `対象: ${validAudios.length} セクション`);

    try {
      // 1. Decode Speech Sections
      const tempCtx = new AudioContext();
      const speechBuffers: AudioBuffer[] = [];
      
      const activeSecs = sections
        .map((text, idx) => ({ text, idx, audio: audiosToUse[idx] }))
        .filter((item): item is { text: string; idx: number; audio: string } => item.audio !== null);

      for (let i = 0; i < activeSecs.length; i++) {
        const item = activeSecs[i];
        const base64 = item.audio;
        
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) bytes[j] = binaryString.charCodeAt(j);
        
        let buffer;
        try {
          buffer = await tempCtx.decodeAudioData(bytes.buffer.slice(0));
        } catch (e) {
          try {
            const evenLength = bytes.length - (bytes.length % 2);
            const int16Data = new Int16Array(bytes.buffer, 0, evenLength / 2);
            const float32Data = new Float32Array(int16Data.length);
            for (let j = 0; j < int16Data.length; j++) float32Data[j] = int16Data[j] / 32768.0;
            buffer = tempCtx.createBuffer(1, float32Data.length, 24000);
            buffer.getChannelData(0).set(float32Data);
          } catch (pcmErr) {
            throw new Error(`Failed to decode speech section ${item.idx + 1}. The audio data might be invalid.`);
          }
        }
        
        const parsed = parseSectionText(item.text);
        const utterances = parseTextIntoUtterances(item.text, parsed.type);
        const bufferWithIntervals = injectIntervalsToAudioBuffer(tempCtx, buffer, utterances);
        
        speechBuffers.push(bufferWithIntervals);
      }

      // 2. Decode BGM if exists
      let bgmBuffer: AudioBuffer | null = null;

      if (bgmFile) {
        addLog('info', `バックグラウンドBGMデコード中: ${bgmFile.name}`);
        try {
          const arrayBuffer = await bgmFile.arrayBuffer();
          bgmBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        } catch (e) {
          console.error('BGM Decoding Error:', e);
          throw new Error('Failed to decode BGM file. Please try a different MP3 or WAV file.');
        }
      }
      await tempCtx.close();

      addLog('info', 'マルチチャンネル・オーバレイ処理、スケジュール作成中...');
      // Calculate Timing
      // BGM starts at 0
      // First speech starts at 4.0
      const SPEECH_START_DELAY = 4.0;
      const POST_SPEECH_DELAY = 5.0;
      const FADE_DURATION = 2.0;
      const SECTION_GAP = 1.5; // 1.5s gap between sections
      
      let currentSpeechTime = SPEECH_START_DELAY;
      const speechStartTimes: number[] = [];
      for (const buffer of speechBuffers) {
        speechStartTimes.push(currentSpeechTime);
        currentSpeechTime += buffer.duration + SECTION_GAP;
      }

      addLog('info', 'タイムスケジュール確定（BGMミックス）', speechStartTimes.map((t, idx) => `セクション ${idx + 1}: ${t.toFixed(2)}秒`).join(' | '));

      const firstSpeechStart = speechStartTimes[0];
      const lastSpeechEnd = currentSpeechTime - SECTION_GAP;
      const totalDuration = lastSpeechEnd + POST_SPEECH_DELAY;
      
      const offlineCtx = new OfflineAudioContext(2, Math.ceil(44100 * totalDuration), 44100);

      // 3. Schedule Speech
      speechBuffers.forEach((buffer, i) => {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start(speechStartTimes[i]);
      });

      // 4. Schedule BGM with Ducking and Fade
      if (bgmBuffer) {
        const bgmSource = offlineCtx.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.loop = true;

        const bgmGain = offlineCtx.createGain();
        const maxBgmVolume = bgmVolume * 0.85; // 最初と最後のBGM音量を85%に制限
        const duckVolume = bgmVolume * 0.1; // Duck to 10% of original BGM volume

        // Initial Volume (Intro)
        bgmGain.gain.setValueAtTime(maxBgmVolume, 0);

        // Continuous Ducking Logic:
        // Fade down just before the FIRST speech starts
        bgmGain.gain.linearRampToValueAtTime(duckVolume, Math.max(0, firstSpeechStart - 0.5));
        
        // Stay at duck volume until the LAST speech ends
        bgmGain.gain.setValueAtTime(duckVolume, lastSpeechEnd);
        
        // Fade back up to full volume after the LAST speech ends (Outro start)
        bgmGain.gain.linearRampToValueAtTime(maxBgmVolume, lastSpeechEnd + 0.5);

        // Final Fade Out at the very end
        const fadeStartTime = totalDuration - FADE_DURATION;
        bgmGain.gain.setValueAtTime(maxBgmVolume, Math.max(lastSpeechEnd + 0.5, fadeStartTime));
        bgmGain.gain.linearRampToValueAtTime(0, totalDuration);

        bgmSource.connect(bgmGain);
        bgmGain.connect(offlineCtx.destination);
        bgmSource.start(0);
        bgmSource.stop(totalDuration);
      }

      const renderedBuffer = await offlineCtx.startRendering();
      
      // 5. Convert to WAV
      addLog('info', 'WAVコーデック出力の開始中...');
      const fileTimestamp = Date.now();
      const downloadName = `radio-show-final-${fileTimestamp}.wav`;
      const wavBlob = audioBufferToWav(renderedBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
      addLog('success', `ミキシング・高音質結合WAVの作成に成功しました！ダウンロード完了: ${downloadName}`, `時間: ${totalDuration.toFixed(1)} 秒`);

      // Generate timing JSON file
      const activeSecsForTiming = activeSecs.map((item) => ({ text: item.text, idx: item.idx }));

      addLog('info', '動画編集ソフト自動アライメント用タイミングJSONを処理中...');
      generateAndDownloadTimingJson(downloadName, speechBuffers, speechStartTimes, totalDuration, activeSecsForTiming);
      addLog('success', '字幕タイミングJSONファイルのダウンロードを開始します。');

    } catch (err: any) {
      console.error('Mixing Error:', err);
      setError('Failed to mix audio: ' + err.message);
      addLog('error', 'ミックス結合の生成中にエラーが発生しました。', err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const audioBufferToWav = (buffer: AudioBuffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    const setUint16 = (data: number) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };

    const setUint32 = (data: number) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan);  // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit
    setUint32(0x61746164);                         // "data" chunk
    setUint32(length - 44);                        // chunk length

    // write channels
    for (i = 0; i < numOfChan; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
      for (i = 0; i < numOfChan; i++) {             // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed int
        view.setInt16(pos, sample, true);          // write 16-bit sample
        pos += 2;
      }
      offset++;                                     // next sample
    }

    return new Blob([bufferArr], { type: 'audio/wav' });
  };

  const downloadAudio = async (base64Data: string, fileName: string) => {
    initAudioContext();
    const ctx = audioContextRef.current!;
    try {
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      let audioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      } catch (e) {
        const evenLength = bytes.length - (bytes.length % 2);
        const int16Data = new Int16Array(bytes.buffer, 0, evenLength / 2);
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
          float32Data[i] = int16Data[i] / 32768.0;
        }
        audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);
      }

      const wavBlob = audioBufferToWav(audioBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading audio:', err);
      setError('Failed to download audio: ' + err.message);
    }
  };

  const combineAndDownload = async (customAudios?: (string | null)[]) => {
    const audiosToUse = customAudios || sectionAudios;
    
    // Check if there are some sections that have text but no audio yet
    const missingAudioSectionsCount = sections.filter((text, idx) => text.trim().length > 0 && !audiosToUse[idx]).length;
    if (missingAudioSectionsCount > 0) {
      addLog('warning', `警告: テキストが存在するが音声が未生成のセクションが ${missingAudioSectionsCount} 件見つかりました。これらのセクションは今回の出力およびタイミングJSONから除外されます。すべてを盛り込むには「すべての音声を生成」を行ってください！`);
    }

    const validAudios = audiosToUse.filter((a): a is string => a !== null);
    if (validAudios.length === 0) {
      addLog('warning', '結合可能な音声パーツがありません。まず音声を生成してください。');
      return;
    }

    setIsGenerating(true);
    setError(null);
    addLog('info', '音声結合処理を開始します...', `対象: ${validAudios.length} セクション`);

    try {
      const tempCtx = new AudioContext();
      const speechBuffers: AudioBuffer[] = [];
      
      const activeSecs = sections
        .map((text, idx) => ({ text, idx, audio: audiosToUse[idx] }))
        .filter((item): item is { text: string; idx: number; audio: string } => item.audio !== null);

      for (let i = 0; i < activeSecs.length; i++) {
        const item = activeSecs[i];
        const base64 = item.audio;

        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let j = 0; j < binaryString.length; j++) bytes[j] = binaryString.charCodeAt(j);
        
        let buffer;
        try {
          buffer = await tempCtx.decodeAudioData(bytes.buffer.slice(0));
        } catch (e) {
          try {
            const evenLength = bytes.length - (bytes.length % 2);
            const int16Data = new Int16Array(bytes.buffer, 0, evenLength / 2);
            const float32Data = new Float32Array(int16Data.length);
            for (let j = 0; j < int16Data.length; j++) float32Data[j] = int16Data[j] / 32768.0;
            buffer = tempCtx.createBuffer(1, float32Data.length, 24000);
            buffer.getChannelData(0).set(float32Data);
          } catch (pcmErr) {
            throw new Error(`Failed to decode speech section ${item.idx + 1}.`);
          }
        }

        const parsed = parseSectionText(item.text);
        const utterances = parseTextIntoUtterances(item.text, parsed.type);
        const bufferWithIntervals = injectIntervalsToAudioBuffer(tempCtx, buffer, utterances);

        speechBuffers.push(bufferWithIntervals);
      }

      await tempCtx.close();

      let totalDuration = 0;
      speechBuffers.forEach(buffer => {
        totalDuration += buffer.duration;
      });

      const offlineCtx = new OfflineAudioContext(1, Math.ceil(24000 * totalDuration), 24000);
      let currentTime = 0;
      const speechStartTimes: number[] = [];

      speechBuffers.forEach(buffer => {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start(currentTime);
        speechStartTimes.push(currentTime);
        currentTime += buffer.duration;
      });

      addLog('info', 'タイムスケジュール確定（シンプル結合）', speechStartTimes.map((t, idx) => `セクション ${idx + 1}: ${t.toFixed(2)}秒`).join(' | '));

      const renderedBuffer = await offlineCtx.startRendering();
      
      const fileTimestamp = Date.now();
      const downloadName = `combined-tts-${fileTimestamp}.wav`;
      const wavBlob = audioBufferToWav(renderedBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
      
      addLog('success', `音声結合WAVの作成に成功しました！ダウンロード完了: ${downloadName}`, `時間: ${totalDuration.toFixed(1)} 秒`);

      // Generate timing JSON file
      const activeSecsForTiming = activeSecs.map((item) => ({ text: item.text, idx: item.idx }));
      addLog('info', 'タイミングJSONを処理中...');
      generateAndDownloadTimingJson(downloadName, speechBuffers, speechStartTimes, totalDuration, activeSecsForTiming);
      addLog('success', '字幕タイミングJSONファイルのダウンロードを開始します。');

    } catch (err: any) {
      console.error('Combine Error:', err);
      setError('Failed to combine audio: ' + err.message);
      addLog('error', '音声結合の生成中にエラーが発生しました。', err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-200/60 text-left">
          <div className="flex items-center gap-3 shrink-0">
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center p-2.5 bg-indigo-600 text-white rounded-xl shadow-md shadow-indigo-100"
            >
              <Volume2 size={24} />
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xl font-bold tracking-tight text-slate-900"
            >
              Gemini TTS
            </motion.h1>
          </div>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-xs md:text-sm text-slate-500 font-medium max-w-xl md:border-l md:border-slate-200/80 md:pl-4 leading-relaxed"
          >
            最高品質の音声合成と、動画編集ソフトにそのままインポートできる正確なタイムスタンプJSONファイルを同時に出力します。
          </motion.p>
        </header>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8 mb-6"
        >
          <button
            type="button"
            onClick={clearAllSections}
            disabled={isGenerating}
            className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors flex items-center gap-2 mx-auto px-4 py-2 rounded-full hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw size={14} />
            すべてのセクションをクリア
          </button>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Input Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* DRAFT Section */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-indigo-600 rounded-3xl shadow-xl shadow-indigo-100 border border-indigo-500 overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Sparkles size={18} className="text-indigo-200" />
                      原稿ベース記事・台本
                    </label>
                    <div className="px-2 py-0.5 bg-indigo-500/30 text-indigo-100 rounded-md text-[10px] font-bold border border-white/10 uppercase">
                      AI自動セグメント分割
                    </div>
                  </div>
                  <div className="text-[10px] font-bold text-indigo-200 uppercase">
                    推奨最大: 1セクション約1,200文字
                  </div>
                </div>
                
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="ここに作成したい長文の記事や台本を貼り付けます。[INTRO]や[CAPTION]、[OUTRO]などのタグ付きスクリプトを入力するとセグメントを正確に自動抽出・再現してパースします..."
                  className="w-full min-h-[160px] p-5 text-base bg-indigo-700/50 border-none text-white placeholder:text-indigo-300 focus:ring-0 rounded-2xl resize-none transition-all"
                />

                <div className="mt-4 flex justify-between items-center">
                  <span className="text-xs font-medium text-indigo-200">
                    {draft.length.toLocaleString()} 文字
                  </span>
                  <button
                    type="button"
                    onClick={handleSplitDraft}
                    disabled={!draft.trim() || isSplitting}
                    className="flex items-center gap-2 px-6 py-3 bg-white text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSplitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        AIセクション分割中...
                      </>
                    ) : (
                      <>
                        <Scissors size={16} />
                        セクションに分割する
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>

            {sections.map((sectionText, index) => (
              <motion.div 
                key={index}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className={cn(
                  "bg-white rounded-3xl shadow-sm border transition-all",
                  activeSectionIndex === index ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"
                )}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 bg-slate-100 rounded-full text-[10px]">
                          {index + 1}
                        </span>
                        セクション {index + 1}
                      </label>
                      {(() => {
                        const parsed = parseSectionText(sectionText);
                        if (parsed.type === 'normal') return null;
                        
                        let badgeStyle = "bg-slate-100 text-slate-700 border-slate-200";
                        let labelText: string = parsed.type;
                        
                        if (parsed.type === 'intro') {
                          badgeStyle = "bg-pink-50 text-pink-700 border-pink-100";
                          labelText = "INTRO 冒頭";
                        } else if (parsed.type === 'outro') {
                          badgeStyle = "bg-violet-50 text-violet-700 border-violet-100";
                          labelText = "OUTRO 締め";
                        } else if (parsed.type === 'topic_label') {
                          badgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
                          labelText = `TOPIC: ${parsed.label || ''} | ${parsed.topic || ''}`;
                        } else if (parsed.type === 'caption') {
                          badgeStyle = "bg-blue-50 text-blue-700 border-blue-100";
                          labelText = "CAPTION 本文";
                        }
                        
                        return (
                          <div className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-bold border", badgeStyle)}>
                            {labelText}
                          </div>
                        );
                      })()}
                      {activeSectionIndex === index && isGenerating ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold border border-indigo-100 animate-pulse">
                          <Loader2 size={10} className="animate-spin" />
                          音声生成中...
                        </div>
                      ) : sectionAudios[index] ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold border border-emerald-100">
                          <Check size={10} />
                          生成完了
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-50 text-slate-400 rounded-full text-[10px] font-bold border border-slate-100">
                          未生成
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={cn(
                        "text-xs font-medium transition-colors",
                        sectionText.length > 1800 ? "text-red-500" : "text-slate-400"
                      )}>
                        {sectionText.length.toLocaleString()} / 2,000 文字
                      </span>
                      <div className="flex gap-2">
                        <button 
                          type="button"
                          onClick={() => copySection(index)}
                          className="p-2 text-slate-400 hover:text-indigo-600 transition-colors rounded-lg hover:bg-slate-50"
                          title="セクションをコピー"
                        >
                          {copiedIndex === index ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                        </button>
                        <button 
                          type="button"
                          onClick={() => updateSection(index, '')}
                          className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-slate-50"
                          title="セクションをクリア"
                        >
                          <RotateCcw size={16} />
                        </button>
                        {sections.length > 1 && (
                          <button 
                            type="button"
                            onClick={() => removeSection(index)}
                            className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-slate-50"
                            title="セクションを削除"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="relative">
                    <textarea
                      value={sectionText}
                      onChange={(e) => {
                        updateSection(index, e.target.value);
                        // Auto-resize
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onFocus={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      placeholder={`ここにセクション ${index + 1} の文章を入力してください...`}
                      className="w-full min-h-[120px] p-4 text-base bg-slate-50 border-none focus:ring-2 focus:ring-indigo-500 rounded-2xl resize-none placeholder:text-slate-400 transition-all overflow-hidden"
                    />
                  </div>

                  {matchesMultipleTags(sectionText) && (
                    <div className="mt-3 bg-amber-50 rounded-2xl border border-amber-200/60 p-4 text-xs text-amber-950 flex flex-col md:flex-row md:items-center justify-between gap-3 font-medium animate-in fade-in duration-200">
                      <div className="flex gap-2 items-start text-left">
                        <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={16} />
                        <div>
                          <p className="font-bold text-amber-950">💡 複数のナレーションタグ（s1, s2 等）が検出されました</p>
                          <p className="text-amber-800/80 mt-1 leading-relaxed">
                            この設定のまま生成しても、自動的に文字の長さに合わせて <b>s1, s2 等の一言ごとの正確なタイムスタンプJSONが自動出力</b>されます。<br />
                            セクションに細かく分割すると、音声の個別パーツごとのプレビュー試聴や、特定の文だけを再生成できるようになります（必要な場合は、右のボタンからいつでも自動分割できます）。
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(sectionText);
                          addLog('info', 'セクション内の原稿をベース台本に転送し、一言ごとの分割を開始しました。');
                          const parsedSegments = splitDraftByTags(sectionText);
                          setSections(parsedSegments);
                          setSectionAudios(new Array(parsedSegments.length).fill(null));
                        }}
                        className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow-md transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer animate-pulse"
                      >
                        <Scissors size={14} />
                        一言ごとにセクション自動分割する
                      </button>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {sectionAudios[index] ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => playAudio(`section-${index}`, sectionAudios[index]!, sectionText)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all",
                              playingId === `section-${index}` && isPlaying
                                ? "bg-red-50 text-red-600 hover:bg-red-100"
                                : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                            )}
                          >
                            {playingId === `section-${index}` && isPlaying ? (
                              <>
                                <Pause size={12} fill="currentColor" />
                                停止
                              </>
                            ) : (
                              <>
                                <Play size={12} fill="currentColor" />
                                再生
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadAudio(sectionAudios[index]!, `section-${index + 1}.wav`)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg font-bold text-[11px] hover:bg-slate-100 transition-all"
                          >
                            <Download size={12} />
                            WAVを保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setSectionAudios(prev => {
                              const n = [...prev];
                              n[index] = null;
                              return n;
                            })}
                            className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-slate-500 rounded-lg font-bold text-[11px] hover:bg-slate-100 transition-all cursor-pointer border border-dashed border-slate-200">
                          <Upload size={12} />
                          音声をアップロード
                          <input 
                            type="file" 
                            accept="audio/*" 
                            className="hidden" 
                            onChange={(e) => handleAudioUpload(index, e)} 
                          />
                        </label>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleGenerateSection(index)}
                      disabled={isGenerating || !sectionText.trim()}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-bold text-xs",
                        activeSectionIndex === index 
                          ? "bg-indigo-100 text-indigo-600" 
                          : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                      )}
                    >
                      {activeSectionIndex === index ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      生成する
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-700"
              >
                <AlertCircle className="shrink-0 mt-0.5" size={18} />
                <p className="text-sm font-medium">{error}</p>
              </motion.div>
            )}

            <button
              type="button"
              onClick={addSection}
              disabled={isGenerating}
              className="w-full py-4 border-2 border-dashed border-slate-200 rounded-3xl text-slate-400 font-bold text-sm hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
            >
              <Volume2 size={16} />
              新しいセクションを追加
            </button>
          </div>

          {/* History Sidebar */}
          <div className="space-y-6">
            {/* Action Buttons Section */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
              <button
                type="button"
                onClick={isPlaying ? stopPlayback : handleGenerateAll}
                disabled={isGenerating || (sections.every(s => !s.trim()) && !isPlaying)}
                className={cn(
                  "w-full px-6 py-4 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
                  isPlaying 
                    ? "bg-red-500 hover:bg-red-600 shadow-red-100" 
                    : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100"
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    {activeSectionIndex !== null ? `セクション ${activeSectionIndex + 1} を生成中...` : '生成処理中...'}
                  </>
                ) : isPlaying ? (
                  <>
                    <Pause size={20} fill="currentColor" />
                    再生を停止
                  </>
                ) : (
                  <>
                    <Play size={20} fill="currentColor" />
                    すべての音声を生成
                  </>
                )}
              </button>

              {/* 一括生成カスタムオプション */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-150 space-y-2.5 text-xs text-slate-700">
                <div className="font-bold text-slate-500 uppercase tracking-widest text-[9px] mb-1">
                  一括生成の動作設定
                </div>
                
                <label className="flex items-start gap-2 cursor-pointer select-none hover:text-indigo-600 transition-colors py-0.5">
                  <input
                    type="checkbox"
                    checked={skipExistingGeneration}
                    onChange={(e) => {
                      setSkipExistingGeneration(e.target.checked);
                      addLog('info', `動作設定変更: 生成済みスキップを ${e.target.checked ? '有効' : '無効'} にしました。`);
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 mt-0.5"
                  />
                  <span>すでに生成完了している部分はスキップ (推奨)</span>
                </label>
                
                <label className="flex items-start gap-2 cursor-pointer select-none hover:text-indigo-600 transition-colors py-0.5">
                  <input
                    type="checkbox"
                    checked={autoCombineAfterGen}
                    onChange={(e) => {
                      setAutoCombineAfterGen(e.target.checked);
                      addLog('info', `動作設定変更: 生成後の自動ダウンロードを ${e.target.checked ? '有効' : '無効'} にしました。`);
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 mt-0.5"
                  />
                  <span>生成完了後に自動でマージ＆ダウンロード</span>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => combineAndDownload()}
                  disabled={sectionAudios.filter(a => a !== null).length < 2}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download size={16} />
                  すべて結合 (WAV+JSON)
                </button>
                
                <button
                  type="button"
                  onClick={() => mixAndDownload()}
                  disabled={sectionAudios.filter(a => a !== null).length === 0 || !bgmFile}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-md shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Music size={16} />
                  結合 ＆ BGM（ミックス出力）
                </button>
              </div>
            </div>

            {/* Settings Section */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-5">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2 px-1">
                <Settings2 size={16} />
                全体設定
              </h2>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase px-1">エピソードタイトル (JSONメタデータ)</label>
                <input
                  type="text"
                  value={episodeTitle}
                  onChange={(e) => setEpisodeTitle(e.target.value)}
                  placeholder="エピソードタイトルを入力..."
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase px-1">声の選択 (Gemini TTS)</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <Volume2 size={16} />
                  </div>
                  <select
                    value={selectedVoice}
                    onChange={(e) => {
                      setSelectedVoice(e.target.value);
                      const voiceObj = VOICES.find(v => v.id === e.target.value);
                      if (voiceObj) {
                        addLog('info', `音声キャラクターを「${voiceObj.name}」に変更しました。 (${voiceObj.gender} / ${voiceObj.aspect})`);
                      }
                    }}
                    className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl appearance-none focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer text-sm font-medium"
                  >
                    {VOICES.map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} ({voice.gender} • {voice.aspect})
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {/* 選択された声の詳細プロフィールプレビュー */}
                {(() => {
                  const selectedVoiceObj = VOICES.find(v => v.id === selectedVoice) || VOICES[0];
                  return (
                    <div className="p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl space-y-1.5 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-indigo-950 text-xs flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                          {selectedVoiceObj.name} の音声プロフィール
                        </span>
                        <span className="px-2 py-0.5 bg-indigo-100/80 text-indigo-700 text-[9px] font-extrabold rounded-full tracking-wider uppercase">
                          {selectedVoiceObj.gender} • {selectedVoiceObj.aspect}
                        </span>
                      </div>
                      <p className="text-[11px] text-indigo-900/85 leading-relaxed font-sans">
                        {selectedVoiceObj.description}
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase px-1 flex items-center gap-1.5">
                  キャラクターのペルソナ（話し方の設定）
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {PERSONA_PRESETS.map((preset) => {
                    const isSelected = selectedPersonaPreset === preset.id;
                    return (
                      <label
                        key={preset.id}
                        className={cn(
                          "flex items-start gap-3 p-3 rounded-2xl border text-xs cursor-pointer transition-all select-none",
                          isSelected
                            ? "border-indigo-500 bg-indigo-50/50 text-indigo-950 font-bold"
                            : "border-slate-200 bg-slate-50/50 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        )}
                      >
                        <input
                          type="radio"
                          name="personaPreset"
                          value={preset.id}
                          checked={isSelected}
                          onChange={() => {
                            setSelectedPersonaPreset(preset.id);
                            if (preset.id !== 'custom') {
                              setPersona(preset.text);
                              addLog('info', `ペルソナを「${preset.name}」に設定しました。`);
                            } else {
                              addLog('info', `フリー入力（カスタムペルソナ）モードに変更されました。`);
                            }
                          }}
                          className="rounded-full border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 mt-0.5 shrink-0"
                        />
                        <div className="space-y-0.5">
                          <span className="block font-semibold">{preset.name}</span>
                          {preset.text ? (
                            <span className="block text-[10px] text-slate-500 font-normal leading-relaxed">
                              {preset.text}
                            </span>
                          ) : (
                            <span className="block text-[10px] text-slate-400 font-normal leading-relaxed">
                              下記の入力欄で指示やキャラクター設定を自由に編集できます。
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">
                      ペルソナ詳細指示（システムプロンプト）
                    </span>
                    {selectedPersonaPreset !== 'custom' && (
                      <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full select-none">
                        プリセット同期中
                      </span>
                    )}
                  </div>
                  <textarea
                    value={persona}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPersona(val);
                      // Auto-sync selection if it matches one of the preset texts exactly
                      const matched = PERSONA_PRESETS.find(p => p.id !== 'custom' && p.text === val);
                      if (matched) {
                        setSelectedPersonaPreset(matched.id);
                      } else {
                        setSelectedPersonaPreset('custom');
                      }
                    }}
                    placeholder="キャラクターの話し方の指示や、独自の追加設定を記述..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-medium min-h-[90px] resize-none leading-relaxed"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 space-y-4">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">BGM（背景音楽）設定</label>
                  {bgmFile && (
                    <button 
                      type="button"
                      onClick={() => setBgmFile(null)} 
                      className="text-[10px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <X size={10} /> 削除する
                    </button>
                  )}
                </div>

                {!bgmFile ? (
                  <div className="space-y-3">
                    <label className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-100 transition-colors">
                      <Music size={16} className="text-slate-400" />
                      <span className="text-xs font-medium text-slate-500">BGMをアップロード</span>
                      <input type="file" accept="audio/mpeg,audio/wav" onChange={handleBgmUpload} className="hidden" />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-full px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-2">
                      <Music size={14} className="text-emerald-500" />
                      <span className="font-bold text-emerald-700 text-xs truncate flex-1">
                        {bgmFile.name}
                      </span>
                    </div>
                    <div className="px-1 space-y-1.5">
                      <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase">
                        <span>BGM音量（音圧）</span>
                        <span>{Math.round(bgmVolume * 100)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="1.0" 
                        step="0.01" 
                        value={bgmVolume} 
                        onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                        className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between px-2 pt-2">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-2 font-sans">
                <History size={16} />
                最近の生成履歴
              </h2>
              {history.length > 0 && (
                <button 
                  type="button"
                  onClick={clearHistory}
                  className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors"
                >
                  履歴をクリア
                </button>
              )}
            </div>

            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {history.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-8 text-center bg-white rounded-3xl border border-dashed border-slate-200"
                  >
                    <p className="text-sm text-slate-400 font-medium">最近の生成履歴はありません</p>
                  </motion.div>
                ) : (
                  history.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="group bg-white p-4 rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all cursor-pointer relative"
                      onClick={() => item.audioData && playAudio(item.id, item.audioData)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full uppercase">
                          {item.voice}
                        </span>
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHistoryItem(item.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all rounded-md"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="text-sm text-slate-600 line-clamp-2 mb-2 font-medium leading-relaxed">
                        {item.text}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.audioData) downloadAudio(item.audioData, `tts-${item.id.slice(0, 8)}.wav`);
                            }}
                            className="flex items-center gap-1 text-slate-400 hover:text-indigo-500 font-bold transition-colors"
                          >
                            <Download size={10} />
                            保存
                          </button>
                          <div className={cn(
                            "flex items-center gap-1 font-bold transition-all",
                            playingId === item.id && isPlaying 
                              ? "text-rose-500 opacity-100" 
                              : "text-indigo-500 opacity-0 group-hover:opacity-100"
                          )}>
                            {playingId === item.id && isPlaying ? (
                              <>
                                <Pause size={10} fill="currentColor" />
                                停止
                              </>
                            ) : (
                              <>
                                <Play size={10} fill="currentColor" />
                                再再生
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* 💡 使い方と出力ファイルのご案内 (Moved above logs console) */}
        <div className="mt-14 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-left bg-indigo-50/50 rounded-3xl p-6 md:p-8 border border-indigo-100/50 shadow-sm space-y-4"
          >
            <h2 className="text-sm md:text-base font-bold text-indigo-950 flex items-center gap-2 border-b border-indigo-100 pb-2">
              <Sparkles size={18} className="text-indigo-600" />
              💡 使い方と出力ファイルのご案内
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-600 leading-relaxed">
              <div className="space-y-2">
                <p className="font-bold text-indigo-950 text-sm pb-1">📖 基本的な操作手順</p>
                <ol className="list-decimal list-inside space-y-2 font-medium pl-1">
                  <li><strong>原稿の入力:</strong> 「原稿ベース記事・台本」に長い記事、コラム、または構成台本をそのままの形式、あるいはタグ付き形式で入力・貼り付けます。</li>
                  <li><strong>セグメント分割:</strong> <code className="bg-white px-1 py-0.5 rounded border text-indigo-600 font-mono text-[10px]">[INTRO]</code> や <code className="bg-white px-1 py-0.5 rounded border text-indigo-600 font-mono text-[10px]">[CAPTION]</code> などのタグ付きスクリプトを入力すると自動で認識・セクション分けされます。タグがない場合はAIが自然な区切りで自動分割します。</li>
                  <li><strong>音声生成:</strong> 必要に応じて右上の全体設定（声の種類やペルソナ指定）を調整し、各セクションの「生成する」または全体の「すべての音声を生成」をクリックします。</li>
                  <li><strong>結合と書き出し:</strong> すべての音声が揃ったら「すべて結合」または「結合 ＆ BGM（ミックス）」を実行して成果物を保存します。</li>
                </ol>
              </div>
              
              <div className="space-y-2">
                <p className="font-bold text-slate-800 text-sm pb-1">📦 出力されるファイル</p>
                <ul className="list-disc list-inside space-y-2 font-medium pl-1">
                  <li>
                    <strong className="text-slate-900">音声ファイル (.wav)</strong>
                    <p className="text-[11px] text-slate-500 ml-4 mt-0.5 font-normal">ポッドキャスト配信や動画音声としてそのまま使える、最高音質の結合済みメインウェーブ音声ファイルです。</p>
                  </li>
                  <li>
                    <strong className="text-indigo-950">タイムスタンプJSONファイル (.json)</strong>
                    <p className="text-[11px] text-slate-500 ml-4 mt-0.5 font-normal">
                      音声の結合出力と同時に、WAVファイルと同名で自動ダウンロードされます。
                      動画編集ソフト（Premiere Pro、DaVinci Resolve、CapCutなど）で
                      <strong>字幕（字幕トラックや字幕カード）、タイトル、カット割り</strong>を声のタイミングに合わせて1ミリ秒の狂いもなく正確に自動同期・整列させるために使用できます。
                    </p>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-5 bg-amber-50/60 rounded-2xl p-4 text-xs border border-amber-100 text-amber-950 font-medium">
              <p className="font-bold text-amber-900 mb-1 flex items-center gap-1.5">
                <AlertCircle size={14} className="text-amber-600 shrink-0" />
                📢 なぜ音声を「セクション」に分割して生成するのか？（長尺ノイズの防止）
              </p>
              <p className="leading-relaxed text-amber-800/95 pl-5">
                AI音声合成の技術的性質上、長い台本を1つの塊として一度に音声化しようとすると、後半にかけて徐々にノイズが混ざったり、読み上げが狂ったり、声がかすれて聞き取りづらくなる（音声の劣化・崩れ）特性があります。
                本ツールでは、お預かりした原稿全体のクオリティを最上級に保つために、短いセクションに分割して安全に生成したのち、最後に音質劣化なくスムーズに結合するインテリジェントな構成を採用しています。<br />
                <span className="text-indigo-900 font-bold block mt-1.5">💡 セクション分割とタイムスタンプJSON（字幕同期）の関係：</span>
                この劣化防止用セクションとは「完全に独立した別レイヤー」として、<b>タイムスタンプJSONは、各セクションの文章内から「すべての一言、一文一文」を賢く自動検出し、それぞれが発声される正確なミリ秒をピンポイントで算出して記録</b>します。
                したがって、セクション分けは音声破壊を防ぐ最適なまとまりでよく、JSONのほうは自動的に一言レベルでフラットに細分化されますので、そのまま動画編集ソフトで快適にご利用いただけます！
              </p>
            </div>
          </motion.div>
        </div>

        {/* Realtime Event & Diagnostic Logs Console (Detached Bottom layout) */}
        <div className="mt-14 max-w-4xl mx-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="p-5 space-y-4 font-mono">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="flex h-1.5 w-1.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500"></span>
                  </span>
                  ⚡ プロセス実行・デバッグログ
                </h2>
                {logs.length > 0 && (
                  <button 
                    type="button"
                    onClick={() => setLogs([])}
                    className="text-[9px] text-slate-400 hover:text-red-400 transition-colors uppercase font-sans font-bold bg-slate-800 px-2 py-1 rounded hover:bg-slate-750"
                  >
                    ログ消去
                  </button>
                )}
              </div>

              <div className="max-h-[220px] overflow-y-auto space-y-2 text-xs pr-1 scrollbar-thin scrollbar-thumb-slate-805 scrollbar-track-transparent">
                {logs.length === 0 ? (
                  <p className="text-slate-500 text-center py-6 font-sans text-xs">ログ履歴はありません。</p>
                ) : (
                  logs.map((log) => {
                    let typeBadgeColor = "text-blue-400";
                    let typeSign = "•";
                    if (log.type === 'success') {
                      typeBadgeColor = "text-emerald-400";
                      typeSign = "✔";
                    } else if (log.type === 'error') {
                      typeBadgeColor = "text-rose-400 font-bold animate-pulse";
                      typeSign = "✘";
                    } else if (log.type === 'warning') {
                      typeBadgeColor = "text-amber-400";
                      typeSign = "⚠";
                    }

                    return (
                      <div key={log.id} className="border-b border-slate-950/20 pb-1.5 last:border-0 hover:bg-slate-850/30 p-1.5 rounded-lg transition-colors">
                        <div className="flex items-start gap-2">
                          <span className={cn("shrink-0 font-bold text-[10px] mt-0.5", typeBadgeColor)}>{typeSign}</span>
                          <div className="flex-1 space-y-0.5 min-w-0">
                            <div className="flex items-center justify-between gap-4">
                              <p className={cn("font-medium break-words leading-relaxed text-[11px]", log.type === 'error' ? 'text-rose-400' : 'text-slate-200')}>
                                {log.message}
                              </p>
                              <span className="text-[9px] text-slate-500 shrink-0 select-none">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            </div>
                            {log.details && (
                              <p className="text-[10px] text-slate-400 break-words bg-slate-950/40 p-2 rounded border border-slate-800/50 mt-1 font-sans leading-relaxed">
                                {log.details}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              {/* Help tip when has error */}
              {logs.some(l => l.type === 'error') && (
                <div className="text-[10px] text-slate-400 border-t border-slate-850 pt-2.5 leading-relaxed font-sans mt-2">
                  💡 <span className="text-amber-400 font-bold">デバッグ時の確認ポイント</span>:
                  <ul className="list-disc pl-3 mt-1 space-y-1 text-slate-400 text-[9px]">
                    <li>APIキー設定を確認してください</li>
                    <li>文字数は1セクション2,000文字以下か確認してください</li>
                    <li>プロンプト/キャラクターペルソナ指定に記号等の競合がないか確認してください</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-20 pb-12 text-center border-t border-slate-100 pt-12">
        <p className="text-xs text-slate-400 font-medium tracking-widest uppercase">
          Powered by Gemini 2.5 Flash
        </p>
      </footer>
    </div>
  );
}
