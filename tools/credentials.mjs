// Shared by TTS Studio and Conversation Lab (repo-level, depends on neither app). Resolve one provider only.
// Which AI Studio / OpenAI project each key belongs to: ~/playbooks/gemini-tts.md and conversation-lab/CREDENTIALS.md.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  // Legacy compatibility: read only GEMINI_API_KEY, without global injection, logging, or copying.
  // Parsed here so this shared module does not depend on either app's node_modules.
  for (const path of [join(repoRoot, 'tts-studio', '.env'), join(repoRoot, '.env')]) {
    if (!existsSync(path)) continue;
    const value = envValue(readFileSync(path, 'utf8'), 'GEMINI_API_KEY');
    if (value) return value;
  }
  throw new Error('WKFL Google credential is not configured');
}

// Last declaration wins, as with dotenv.
function envValue(text, name) {
  let value;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!m || m[1] !== name) continue;
    const raw = m[2].trim();
    const quoted = raw.match(/^(['"`])(.*)\1$/);
    value = (quoted ? quoted[2] : raw.replace(/\s+#.*$/, '')).trim();
  }
  return value;
}

// OpenAI (Conversation Lab Realtime). Only an explicit file or the central WKFL file: the plain
// OPENAI_API_KEY variable is ignored because other projects on this machine use their own keys.
export function openaiCredentialSource({ env = process.env, home = homedir() } = {}) {
  if (env.OPENAI_API_KEY_FILE) {
    if (!isAbsolute(env.OPENAI_API_KEY_FILE)) throw new Error('OPENAI_API_KEY_FILE must be absolute');
    return { type: 'explicit-file', path: env.OPENAI_API_KEY_FILE };
  }
  const canonical = join(home, '.secrets', 'wkfl', 'openai-token');
  if (existsSync(canonical)) return { type: 'wkfl-home-secret', path: canonical };
  return { type: 'missing' };
}
export function loadOpenAIKey({ env = process.env, home = homedir(), mock = false } = {}) {
  if (mock) return undefined;
  const source = openaiCredentialSource({ env, home });
  if (source.type === 'missing') throw new Error('WKFL OpenAI credential is not configured');
  const value = readFileSync(source.path, 'utf8').trim();
  if (!value) throw new Error('Empty credential file');
  return value;
}
