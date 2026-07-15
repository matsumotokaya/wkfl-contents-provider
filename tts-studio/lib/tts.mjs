// TTS provider layer. Currently: Gemini (same model/prompt as the AI Studio
// app). Additional providers can be added to PROVIDERS with the same
// synthesize() signature.
//
// Set WKFL_TTS_MOCK=1 to skip the API and produce placeholder audio whose
// duration approximates real speech — lets the full pipeline (mixing, BGM,
// timing JSON, prepare.mjs handoff) be tested without an API key.

import { GoogleGenAI } from "@google/genai";

const MAX_SECTION_CHARS = 2000; // hard API-quality limit, same as the app
const MAX_RETRIES = 2;

function buildPrompt(cleanText, persona) {
  return persona
    ? `Please read the following text in a "${persona}" custom character tone. Do not write or speak any introductory greetings, confirmations, or chat responses. Immediately start reading the exact text, and outputs ONLY the spoken audio (no text output allowed at all): "${cleanText}"`
    : `Say this exact text and output ONLY the spoken audio, do not include any text responses: "${cleanText}"`;
}

function mockPcm(text) {
  // ~7 chars/sec speaking rate; quiet 220 Hz tone with per-sentence pauses.
  const rate = 24000;
  const seconds = Math.max(1, text.length / 7);
  const n = Math.round(seconds * rate);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const on = Math.floor(t * 2) % 4 !== 3; // brief gaps to sound speech-like
    pcm[i] = on ? Math.round(Math.sin(2 * Math.PI * 220 * t) * 6000) : 0;
  }
  return { pcm, sampleRate: rate };
}

async function geminiSynthesize({ text, voice, persona, model, apiKey }) {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(text, persona);

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      });
      const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      const data = part?.inlineData?.data;
      if (!data) throw new Error("No audio data in response (content may have been blocked).");

      const rateMatch = part.inlineData.mimeType?.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      const buf = Buffer.from(data, "base64");
      const even = buf.length - (buf.length % 2);
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + even));
      return { pcm, sampleRate };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

const PROVIDERS = {
  gemini: geminiSynthesize,
};

// Synthesize one section of clean speech text (interval tags already
// stripped by timing.speechText). Returns {pcm: Int16Array, sampleRate}.
export async function synthesizeSection({ text, voice, persona, model, provider = "gemini", apiKey }) {
  if (text.length > MAX_SECTION_CHARS) {
    throw new Error(`Section too long for TTS (${text.length} > ${MAX_SECTION_CHARS} chars).`);
  }
  if (process.env.WKFL_TTS_MOCK === "1") return mockPcm(text);

  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to tts-studio/.env or the repo root .env.");
  const synthesize = PROVIDERS[provider];
  if (!synthesize) throw new Error(`Unknown TTS provider: ${provider}`);
  return synthesize({ text, voice, persona, model, apiKey });
}
