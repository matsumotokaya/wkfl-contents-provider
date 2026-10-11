import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['server.mjs', 'scripts-check.mjs', ...['lib', 'public', 'test', 'scripts'].flatMap(dir => readdirSync(dir).filter(f => /\.(mjs|js)$/.test(f)).map(f => `${dir}/${f}`))];
for (const file of files) { const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status || 1); }
console.log(`Syntax checks passed (${files.length} files).`);
