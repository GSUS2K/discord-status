import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = resolve(root, 'dist');
const outFile = resolve(distDir, 'discord-status-extension.zip');

await mkdir(distDir, { recursive: true });
await rm(outFile, { force: true });

await createZip(outFile, [
  { type: 'dir', src: 'extension' },
  { type: 'dir', src: 'discord-assets-real' },
  { type: 'dir', src: 'backend' },
  { type: 'file', src: 'README.md' },
  { type: 'file', src: 'install.sh' }
], [
  'backend/node_modules/**',
  'backend/.env',
  'backend/.dockerignore',
  'backend/.gitignore',
  'backend/Dockerfile',
  'backend/Procfile',
  'backend/docker-compose.yml',
  'backend/fly.toml',
  'backend/runtime.txt',
  'backend/generate_icons.py',
  'discord-assets-real/**/*.zip',
  'discord-assets-real/svg-sources/**',
  '**/.DS_Store',
  '**/._*'
]);

console.log(`Packaged ${outFile}`);

async function createZip(outputPath, entries, ignorePatterns) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolvePromise);
    output.on('error', reject);
    archive.on('warning', warning => {
      if (warning.code === 'ENOENT') {
        return;
      }
      reject(warning);
    });
    archive.on('error', reject);

    archive.pipe(output);
    for (const entry of entries) {
      if (entry.type === 'dir') {
        archive.directory(resolve(root, entry.src), entry.src, {
          ignore: ignorePatterns
        });
      } else {
        archive.file(resolve(root, entry.src), { name: entry.src });
      }
    }

    archive.finalize();
  });
}
