import { existsSync, readFileSync } from 'node:fs';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const packageVersion = readJson('package.json').version;
const versions = {
  package: packageVersion,
  lockfile: readJson('package-lock.json').version,
  extension: readJson('extension/manifest.json').version,
  tauri: readJson('src-tauri/tauri.conf.json').version,
  cargo: readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1],
  cargoLock: readFileSync('src-tauri/Cargo.lock', 'utf8').match(/name = "activity-status-companion"\s+version = "([^"]+)"/s)?.[1]
};

const mismatches = Object.entries(versions).filter(([, version]) => version !== packageVersion);
if (mismatches.length) {
  console.error(`Release version mismatch. Expected ${packageVersion}:`);
  for (const [name, version] of mismatches) console.error(`  ${name}: ${version || 'missing'}`);
  process.exit(1);
}

const requiredUiAssets = [
  'docs/assets/icon128.png',
  'docs/assets/showcase-extension.png',
  'docs/assets/showcase-companion.png',
  'docs/assets/showcase-settings.png',
  'docs/site.css',
  'docs/site-polish.css',
  'docs/site.js',
  'extension/popup-redesign.css',
  'extension/popup-polish.css',
  'extension/options-redesign.css',
  'extension/options-polish.css',
  'tauri-ui/app-redesign.css',
  'tauri-ui/app-polish.css',
  'tauri-ui/settings-redesign.css',
  'tauri-ui/settings-polish.css',
  'tauri-ui/selector-redesign.css',
  'tauri-ui/selector-polish.css'
];
const missingAssets = requiredUiAssets.filter(path => !existsSync(path));
if (missingAssets.length) {
  console.error(`Missing interface assets: ${missingAssets.join(', ')}`);
  process.exit(1);
}

const staleReadmeAssets = /store-(?:marquee|screenshot)|docs\/assets\/hero\.png/i;
if (staleReadmeAssets.test(readFileSync('README.md', 'utf8'))) {
  console.error('README still references outdated interface screenshots');
  process.exit(1);
}

const visibleUiFiles = [
  'docs/index.html',
  'extension/popup.html',
  'tauri-ui/index.html',
  'tauri-ui/selector.html'
];
for (const file of visibleUiFiles) {
  const content = readFileSync(file, 'utf8');
  if (/ARTWORK FROM SOURCE|Series, season and episode|Episode title when available/i.test(content)) {
    console.error(`${file} contains unfinished product copy`);
    process.exit(1);
  }
}

console.log(`release files agree on version ${packageVersion}`);
