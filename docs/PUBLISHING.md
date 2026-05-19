# Publishing Discord Status

This is the maintainer checklist for shipping the **Discord Status** Chrome extension and the **Activity Status** Discord Rich Presence application.

## 1. Discord Developer Portal

1. Create or open your Discord application.
2. Name it `Activity Status`.
3. Upload every image from `discord-assets-real/` under **Rich Presence > Art Assets**.
4. Use the exact keys from `discord-assets-real/UPLOAD_KEYS.txt`.
5. Copy the application/client ID from **General Information**.

The client ID is public. It is safe to ship in the app. Do not ship bot tokens, OAuth secrets, or private keys.

## 2. Configure The Companion App

Open:

```text
companion/activity-status.config.cjs
```

Replace:

```js
discordClientId: 'REPLACE_WITH_YOUR_ACTIVITY_STATUS_CLIENT_ID'
```

with your real Discord application/client ID.

## 3. Build The Extension Packages

```bash
npm install
npm --prefix backend install
npm run package
npm run package:webstore
```

Outputs:

```text
dist/activity-status-extension.zip      # GitHub/manual install bundle
dist/discord-status-webstore.zip        # Chrome Web Store upload
```

Use `dist/discord-status-webstore.zip` for the Chrome Web Store. It contains `manifest.json` at the zip root.

## 4. Build Companion Apps

Build current platform:

```bash
npm run dist:companion
```

Build specific platforms:

```bash
npm run dist:companion:mac
npm run dist:companion:win
npm run dist:companion:linux
```

Output:

```text
companion-dist/
```

For public distribution, signed/notarized builds are strongly recommended:

- macOS: Apple Developer ID signing and notarization
- Windows: code-signing certificate
- Linux: AppImage/deb artifacts are usually fine unsigned, depending on target audience

## 5. Chrome Web Store Distribution

Best user experience:

1. Publish `dist/discord-status-webstore.zip` to the Chrome Web Store as **Discord Status**.
2. Link users to the Web Store listing.
3. Publish companion app installers through GitHub Releases.

When you change extension code after publishing, update `extension/manifest.json` to a higher version, rebuild `dist/discord-status-webstore.zip`, upload the new package, and submit it for review. Once approved, Chrome auto-updates installed users.

GitHub-only flow:

1. Upload `activity-status-extension.zip`.
2. Users unzip and load the `extension/` folder through `chrome://extensions`.

Chrome does not allow a normal native app to silently install an unpacked extension for users. The Chrome Web Store is the clean path.

## 6. User-Facing Release Checklist

Each GitHub release should include:

- Activity Status Companion for macOS
- Activity Status Companion for Windows
- Activity Status Companion for Linux
- Discord Status extension zip, unless the Chrome Web Store listing is live
- Short install notes
- Known site detector limitations

## 7. What Users Should Not Need

Users should not need to:

- create a Discord app
- upload Rich Presence assets
- edit `DISCORD_CLIENT_ID`
- run `npm start`
- install Node.js manually, once companion builds are published

Those are maintainer/developer tasks only.
