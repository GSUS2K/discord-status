const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

exports.default = async function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);

  if (!existsSync(appPath)) {
    throw new Error(`macOS app bundle not found for ad-hoc signing: ${appPath}`);
  }

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  });
};
