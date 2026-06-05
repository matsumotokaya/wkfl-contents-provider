// Episode JSON types (output of the WKFL TTS app) and a helper that turns the
// coarse "normal" segments into sentence-level captions. The source JSON only
// provides start/end times per segment, so we distribute each segment's time
// window across its sentences proportionally by character count.

export type Segment = {
  id: string;
  type: string;
  text: string;
  start_ms: number;
  end_ms: number;
};

export type Episode = {
  version: string;
  title: string;
  date: string;
  audio_file: string;
  total_duration_ms: number;
  segments: Segment[];
};

export type Caption = {
  text: string;
  startMs: number;
  endMs: number;
  segmentIndex: number;
};

// Episode metadata authored by hand in articles/{date}/meta.json. `image` is
// resolved by prepare.mjs to a public/ filename when an asset exists, else null.
export type Topic = {
  no: number;
  headline: string;
  media: string;
  image: string | null;
  start_ms: number;
};

export type Meta = {
  program: string;
  title: string;
  date: string;
  links?: {
    note?: string;
    x?: string;
    spotify?: string;
  };
  topics: Topic[];
};

const splitSentences = (text: string): string[] => {
  // Drop paragraph breaks, then split after Japanese sentence enders while
  // keeping the punctuation attached to its sentence.
  const normalized = text.replace(/\s*\n+\s*/g, "").trim();
  const parts = normalized.match(/[^。！？]*[。！？]/g) ?? [normalized];
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
};

export const buildCaptions = (episode: Episode): Caption[] => {
  const captions: Caption[] = [];

  episode.segments.forEach((seg, segIndex) => {
    const sentences = splitSentences(seg.text);
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
    const span = seg.end_ms - seg.start_ms;

    let cursor = seg.start_ms;
    sentences.forEach((sentence) => {
      const dur = (sentence.length / totalChars) * span;
      captions.push({
        text: sentence,
        startMs: cursor,
        endMs: cursor + dur,
        segmentIndex: segIndex,
      });
      cursor += dur;
    });
  });

  return captions;
};
