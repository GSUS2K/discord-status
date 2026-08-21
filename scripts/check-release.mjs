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
  'docs/assets/showcase-discord.png',
  'docs/assets/showcase-extension.png',
  'docs/assets/showcase-companion.png',
  'docs/assets/showcase-selector.png',
  'docs/assets/showcase-settings.png',
  'docs/assets/store-small-promo.png',
  'docs/assets/store-marquee-promo.png',
  'docs/assets/media/stranger-things-netflix.jpg',
  'docs/assets/media/solo-leveling-crunchyroll.webp',
  'docs/assets/media/loki-hotstar.jpg',
  'docs/assets/media/starboy-spotify.jpg',
  'docs/assets/media/blinding-lights-youtube.jpg',
  'docs/site.css',
  'docs/site-polish.css',
  'docs/site.js',
  'extension/popup-redesign.css',
  'extension/popup-polish.css',
  'extension/popup-fixes.css',
  'extension/options-redesign.css',
  'extension/options-polish.css',
  'extension/options-fixes.css',
  'tauri-ui/app-redesign.css',
  'tauri-ui/app-polish.css',
  'tauri-ui/app-fixes.css',
  'tauri-ui/settings-redesign.css',
  'tauri-ui/settings-polish.css',
  'tauri-ui/settings-fixes.css',
  'tauri-ui/selector-redesign.css',
  'tauri-ui/selector-polish.css'
];
const missingAssets = requiredUiAssets.filter(path => !existsSync(path));
if (missingAssets.length) {
  console.error(`Missing interface assets: ${missingAssets.join(', ')}`);
  process.exit(1);
}

const layoutGuards = new Map([
  ['tauri-ui/app-fixes.css', ['flex: 1 1 auto', '.content > *', 'max-height: none', 'scrollbar-gutter: stable']],
  ['tauri-ui/settings-fixes.css', ['overflow-y: auto', 'position: sticky', 'height: auto', 'min-height: 100vh']]
]);
for (const [file, snippets] of layoutGuards) {
  const content = readFileSync(file, 'utf8');
  const missing = snippets.filter(snippet => !content.includes(snippet));
  if (missing.length) {
    console.error(`${file} is missing layout safeguards: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const communityFiles = [
  'README.md',
  'docs/index.html',
  'extension/popup.js',
  'extension/options.js',
  'tauri-ui/index.html',
  'tauri-ui/settings.html',
  'src-tauri/src/main.rs'
];
for (const file of communityFiles) {
  if (!/discord\.gg\/86mbTq2yZX|open_discord_server/.test(readFileSync(file, 'utf8'))) {
    console.error(`${file} is missing the Discord community link`);
    process.exit(1);
  }
}

const storeImageSizes = new Map([
  ['docs/assets/store-small-promo.png', [440, 280]],
  ['docs/assets/store-marquee-promo.png', [1400, 560]],
  ['docs/assets/showcase-discord.png', [1280, 800]],
  ['docs/assets/showcase-extension.png', [1280, 800]],
  ['docs/assets/showcase-companion.png', [1280, 800]],
  ['docs/assets/showcase-selector.png', [1280, 800]],
  ['docs/assets/showcase-settings.png', [1280, 800]]
]);
for (const [file, [expectedWidth, expectedHeight]] of storeImageSizes) {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    console.error(`${file} must be ${expectedWidth}x${expectedHeight}, found ${width}x${height}`);
    process.exit(1);
  }
}

const staleReadmeAssets = /store-(?:marquee|screenshot)|docs\/assets\/hero\.png/i;
if (staleReadmeAssets.test(readFileSync('README.md', 'utf8'))) {
  console.error('README still references outdated interface screenshots');
  process.exit(1);
}

const visibleUiFiles = [
  'backend/server.js',
  'docs/index.html',
  'extension/popup.html',
  'tauri-ui/index.html',
  'tauri-ui/selector.html'
];
for (const file of visibleUiFiles) {
  const content = readFileSync(file, 'utf8');
  if (/ARTWORK FROM SOURCE|Series, season and episode|Episode title when available|Doing something cool|Neon Harbor|Signal Lost/i.test(content)) {
    console.error(`${file} contains unfinished product copy`);
    process.exit(1);
  }
}

for (const file of ['README.md', 'docs/index.html', 'docs/assets/showcase-discord.svg', 'docs/assets/showcase-selector.svg', 'docs/assets/store-small-promo.svg', 'docs/assets/store-marquee-promo.svg']) {
  const content = readFileSync(file, 'utf8');
  if (!/Stranger Things/i.test(content)) {
    console.error(`${file} is missing the verified media example`);
    process.exit(1);
  }
}

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const friendlyAssets = [
  'Discord-Status-Companion-Windows-x64-Setup.exe',
  'Discord-Status-Companion-Windows-x64-MSI.msi',
  'Discord-Status-Companion-macOS-Apple-Silicon.dmg',
  'Discord-Status-Companion-macOS-Intel-x64.dmg',
  'Discord-Status-Companion-Linux-x86_64.AppImage',
  'Discord-Status-Companion-Linux-Debian-Ubuntu-x86_64.deb',
  'Discord-Status-Extension-Full.zip',
  'Discord-Status-Extension-Chrome-Web-Store.zip'
];
for (const asset of friendlyAssets) {
  if (!releaseWorkflow.includes(asset)) {
    console.error(`Release workflow is missing readable asset name: ${asset}`);
    process.exit(1);
  }
}

console.log(`release files agree on version ${packageVersion}`);
