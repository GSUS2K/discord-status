import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const background = read('extension/scripts/background.js');
const options = read('extension/options.js');
const manifest = read('extension/manifest.json');

const enabledSites = background.match(/const DEFAULT_ENABLED_SITES = \[([\s\S]*?)\];/m)?.[1]
  .match(/'([^']+)'/g)
  ?.map(value => value.slice(1, -1)) || [];
const configuredSites = [...options.matchAll(/\['([^']+)',\s*'[^']+'\]/g)].map(match => match[1]);
const missingOptions = enabledSites.filter(site => !configuredSites.includes(site));
const requiredFiles = [
  'extension/scripts/background.js',
  'extension/scripts/generic.js',
  'extension/scripts/netflix.js',
  'extension/scripts/youtube.js',
  'extension/scripts/spotify.js',
  'extension/scripts/googlemeet.js'
];
const missingFiles = requiredFiles.filter(path => !existsSync(path));
const requiredManifestEntries = [
  'scripts/netflix.js',
  'scripts/youtube.js',
  'scripts/spotify.js',
  'scripts/googlemeet.js',
  'scripts/generic.js'
];
const missingManifestEntries = requiredManifestEntries.filter(entry => !manifest.includes(entry));

if (missingOptions.length || missingFiles.length || missingManifestEntries.length) {
  if (missingOptions.length) console.error(`Sites missing from options: ${missingOptions.join(', ')}`);
  if (missingFiles.length) console.error(`Detector files missing: ${missingFiles.join(', ')}`);
  if (missingManifestEntries.length) console.error(`Detector files missing from manifest: ${missingManifestEntries.join(', ')}`);
  process.exit(1);
}

console.log(`detector inventory is aligned for ${enabledSites.length} enabled sites`);
