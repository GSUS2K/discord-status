const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const KEEP_LOCALES = new Set(['en.lproj', 'en_US.lproj']);

exports.default = async function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);

  if (!existsSync(appPath)) {
    throw new Error(`macOS app bundle not found for ad-hoc signing: ${appPath}`);
  }

  pruneElectronLocales(appPath);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  });
};

function pruneElectronLocales(appPath) {
  const resourcesPath = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );

  if (!existsSync(resourcesPath)) {
    return;
  }

  for (const entry of readdirSync(resourcesPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.lproj') || KEEP_LOCALES.has(entry.name)) {
      continue;
    }

    rmSync(path.join(resourcesPath, entry.name), { recursive: true, force: true });
  }
}
