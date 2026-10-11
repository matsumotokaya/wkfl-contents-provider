export function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function mockTone(rate = 24000) {
  const pcm = Buffer.alloc(rate); // Half a second; explicitly synthetic test data.
  for (let i = 0; i < rate / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / rate) * 1800), i * 2);
  return pcm;
}
export function pcmFromBase64(data) {
  if (typeof data !== 'string' || data.length > 48000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid PCM');
  const pcm = Buffer.from(data, 'base64');
  if (!pcm.length || pcm.length % 2 || pcm.toString('base64') !== data) throw new Error('Invalid PCM');
  return pcm;
}
// Browser capture runs at 16 kHz (shared with Gemini); OpenAI Realtime takes 24 kHz PCM16.
// Linear interpolation is enough for speech input.
export function upsample16kTo24k(pcm) {
  const input = pcm.length / 2, frames = Math.floor(input * 3 / 2), out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const position = i * 2 / 3, index = Math.floor(position), fraction = position - index;
    const a = pcm.readInt16LE(Math.min(index, input - 1) * 2), b = pcm.readInt16LE(Math.min(index + 1, input - 1) * 2);
    out.writeInt16LE(Math.round(a + (b - a) * fraction), i * 2);
  }
  return out;
}
