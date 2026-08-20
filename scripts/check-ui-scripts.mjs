import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = [
  'tauri-ui/index.html',
  'tauri-ui/settings.html',
  'tauri-ui/selector.html',
  'companion/index.html',
  'companion/settings.html'
];

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    new vm.Script(match[1], { filename: `${file}:script${index}` });
  });
}

console.log(`inline UI scripts parsed for ${files.length} pages`);
