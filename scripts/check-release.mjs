import { readFileSync } from 'node:fs';

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

console.log(`release files agree on version ${packageVersion}`);
