import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';

// Only the requested provider is resolved. Never inject a whole env file globally.
export function credentialSource({ env = process.env, home = homedir(), repoRoot } = {}) {
  if (env.GEMINI_API_KEY_FILE) {
    if (!isAbsolute(env.GEMINI_API_KEY_FILE)) throw new Error('GEMINI_API_KEY_FILE must be absolute');
    return { type: 'explicit-file', path: env.GEMINI_API_KEY_FILE };
  }
  if (env.GEMINI_API_KEY) return { type: 'process-env' };
  const canonical = join(home, '.secrets', 'gemini-token');
  if (existsSync(canonical)) return { type: 'home-secret', path: canonical };
  for (const path of [join(repoRoot, 'tts-studio', '.env'), join(repoRoot, '.env')]) {
    if (existsSync(path)) return { type: 'legacy-env-candidate', path };
  }
  return { type: 'missing' };
}
export function loadGoogleKey({ env = process.env, home = homedir(), repoRoot } = {}) {
  const source = credentialSource({ env, home, repoRoot });
  if (source.type === 'process-env') return env.GEMINI_API_KEY.trim();
  if (source.type === 'explicit-file' || source.type === 'home-secret') {
    const value = readFileSync(source.path, 'utf8').trim();
    if (!value) throw new Error('Empty credential file');
    return value;
  }
  // Compatibility only, until a separately approved secret migration is complete.
  for (const path of [join(repoRoot, 'tts-studio', '.env'), join(repoRoot, '.env')]) {
    if (!existsSync(path)) continue;
    const value = parseEnv(readFileSync(path, 'utf8')).GEMINI_API_KEY?.trim();
    if (value) return value;
  }
  throw new Error('Google credential is not configured');
}
