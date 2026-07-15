// Split a podcast markdown script into TTS-sized narration sections.
//
// Input: the *_podcast.md files produced by the WKFL article pipeline
// (H1 title followed by plain-prose paragraphs). Output: an ordered list
// of sections, each below maxChars, never breaking mid-sentence.

const SECTION_MAX_DEFAULT = 1100;

export function extractTitle(markdown) {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// Remove markdown decorations that must not be read aloud.
export function stripMarkdown(markdown) {
  return markdown
    .replace(/^#{1,6}\s+.*$/gm, "") // headings (incl. the title)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// Split text into sentences, keeping terminal punctuation.
export function splitSentences(text) {
  const sentences = [];
  let current = "";
  for (const ch of text) {
    current += ch;
    if (/[。！？!?\n]/.test(ch)) {
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = "";
    }
  }
  const rest = current.trim();
  if (rest) sentences.push(rest);
  return sentences;
}

// Break a single over-long paragraph into sentence-boundary chunks.
function chunkParagraph(paragraph, maxChars) {
  if (paragraph.length <= maxChars) return [paragraph];
  const chunks = [];
  let current = "";
  for (const sentence of splitSentences(paragraph)) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current);
      current = "";
    }
    current += sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Main entry: markdown -> { title, sections }
export function splitScript(markdown, maxChars = SECTION_MAX_DEFAULT) {
  const title = extractTitle(markdown);
  const body = stripMarkdown(markdown);

  // Collapse intra-paragraph newlines (Japanese prose needs no space).
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, "").trim())
    .filter(Boolean);

  const units = paragraphs.flatMap((p) => chunkParagraph(p, maxChars));

  const sections = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 1 > maxChars) {
      sections.push(current);
      current = "";
    }
    current = current ? `${current}\n${unit}` : unit;
  }
  if (current) sections.push(current);

  return { title, sections };
}
