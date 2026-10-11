// Shared by WKFL TTS Studio and Conversation Lab. Resolve one provider only.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireStudio = createRequire(new URL('../tts-studio/package.json', import.meta.url));

export function credentialSource({ env = process.env, home = homedir(), repoRoot = defaultRoot } = {}) {
  if (env.GEMINI_API_KEY_FILE) {
    if (!isAbsolute(env.GEMINI_API_KEY_FILE)) throw new Error('GEMINI_API_KEY_FILE must be absolute');
    return { type: 'explicit-file', path: env.GEMINI_API_KEY_FILE };
  }
  if (env.GEMINI_API_KEY) return { type: 'process-env' };
  const canonical = join(home, '.secrets', 'wkfl', 'gemini-token');
  if (existsSync(canonical)) return { type: 'wkfl-home-secret', path: canonical };
  // Never discover a generic or other project's Google key automatically.
  for (const path of [join(repoRoot, 'tts-studio', '.env'), join(repoRoot, '.env')]) {
    if (existsSync(path)) return { type: 'legacy-env-candidate', path };
  }
  return { type: 'missing' };
}
export function loadGoogleKey({ env = process.env, home = homedir(), repoRoot = defaultRoot, mock = false } = {}) {
  if (mock) return undefined;
  const source = credentialSource({ env, home, repoRoot });
  if (source.type === 'process-env') return env.GEMINI_API_KEY.trim();
  if (source.type === 'explicit-file' || source.type === 'wkfl-home-secret') {
    const value = readFileSync(source.path, 'utf8').trim();
    if (!value) throw new Error('Empty credential file');
    return value;
  }
  // Parse without global injection, logging, or copying credentials. dotenv is
  // needed only for the existing Studio's legacy compatibility path (Node 18+).
  for (const path of [join(repoRoot, 'tts-studio', '.env'), join(repoRoot, '.env')]) {
    if (!existsSync(path)) continue;
    const { parse } = requireStudio('dotenv');
    const value = parse(readFileSync(path, 'utf8')).GEMINI_API_KEY?.trim();
    if (value) return value;
  }
  throw new Error('WKFL Google credential is not configured');
}
