import { mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const extensionDir = resolve(root, 'extension');
const distDir = resolve(root, 'dist');
const outFile = resolve(distDir, 'discord-status-webstore.zip');

await mkdir(distDir, { recursive: true });
await rm(outFile, { force: true });

await run('zip', [
  '-r',
  outFile,
  '.',
  '-x',
  '.DS_Store',
  '*/.DS_Store'
]);

console.log(`Packaged Chrome Web Store upload: ${outFile}`);

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: extensionDir,
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
