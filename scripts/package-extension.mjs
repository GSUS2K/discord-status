import { mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const distDir = resolve(root, 'dist');
const outFile = resolve(distDir, 'browser-presence-extension.zip');

await mkdir(distDir, { recursive: true });
await rm(outFile, { force: true });

await run('zip', [
  '-r',
  outFile,
  'extension',
  'discord-assets-real',
  'backend',
  'README.md',
  'install.sh',
  '-x',
  'backend/node_modules/*',
  'backend/.env',
  'backend/.dockerignore',
  'backend/.gitignore',
  'backend/Dockerfile',
  'backend/Procfile',
  'backend/docker-compose.yml',
  'backend/fly.toml',
  'backend/runtime.txt',
  'backend/generate_icons.py',
  'discord-assets-real/*.zip',
  'discord-assets-real/svg-sources/*',
  '*/.DS_Store'
]);

console.log(`Packaged ${outFile}`);

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.pipe(createWriteStream('/dev/stdout'));
    child.stderr.pipe(createWriteStream('/dev/stderr'));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with ${code}`));
      }
    });
  });
}
