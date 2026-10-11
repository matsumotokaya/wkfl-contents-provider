import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Reuse the existing WKFL install when available. A standalone install also works.
let ws;
try { ws = require('ws'); }
catch { ws = createRequire(new URL('../../tts-studio/package.json', import.meta.url))('ws'); }
export const { WebSocket, WebSocketServer } = ws;
