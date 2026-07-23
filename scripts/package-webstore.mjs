import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDir = resolve(root, 'extension');
const distDir = resolve(root, 'dist');
const outFile = resolve(distDir, 'discord-status-webstore.zip');

await mkdir(distDir, { recursive: true });
await rm(outFile, { force: true });

await createZip(outFile);

console.log(`Packaged Chrome Web Store upload: ${outFile}`);

function createZip(outputPath) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolvePromise);
    output.on('error', reject);
    archive.on('warning', warning => {
      if (warning.code === 'ENOENT') return;
      reject(warning);
    });
    archive.on('error', reject);

    archive.pipe(output);
    archive.glob('**/*', {
      cwd: extensionDir,
      dot: true,
      ignore: ['**/.DS_Store', '**/._*']
    });
    archive.finalize();
  });
}
