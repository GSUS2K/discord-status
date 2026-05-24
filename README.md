# Discord Status

Show what you are watching, listening to, reading, or working on as a Discord Rich Presence status from Chrome.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/ekobpekegflobmheipgceigkldggkakd"><img alt="Chrome Web Store" src="https://img.shields.io/badge/install-chrome%20web%20store-5865F2?style=for-the-badge&labelColor=1b1f23"></a>
  <a href="https://github.com/GSUS2K/discord-status/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/GSUS2K/discord-status?style=for-the-badge&label=companion"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/GSUS2K/discord-status?style=for-the-badge"></a>
  <a href="https://github.com/GSUS2K/discord-status/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/GSUS2K/discord-status?style=for-the-badge"></a>
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Discord Status preview">
</p>

## Install In 3 Steps

1. Install [Discord Status from the Chrome Web Store](https://chromewebstore.google.com/detail/ekobpekegflobmheipgceigkldggkakd).
2. Install [Activity Status Companion](https://github.com/GSUS2K/discord-status/releases/latest) for macOS, Windows, or Linux.
3. Open Discord desktop and keep the companion running from the menu bar/system tray.

The extension detects browser activity. The companion sends it to Discord through local Discord RPC.

## Features

| Feature | Details |
| --- | --- |
| Browser activity detection | YouTube, Netflix, Spotify, Twitch, GitHub, ChatGPT, Google Meet, Crunchyroll, Hotstar, Google, Wikipedia, and manual status |
| Companion activity inbox | The extension reports all detected tabs; the companion can select what Discord should show |
| Smart auto mode | Prioritizes the current Chrome tab and avoids background-tab flicker |
| Active tab only mode | Ignores background tabs completely |
| Popup controls | Toggle status, choose sites, set manual title/message, select tabs, refresh, reconnect, clear, and open support |
| Native companion | Lightweight Tauri app for macOS menu bar, Windows tray, and Linux tray |
| Diagnostics | Backend health, Discord RPC health, logs, copy diagnostics, and port fallback |

## Screenshots

<p align="center">
  <img src="docs/assets/popup.png" alt="Extension popup" width="49%">
  <img src="docs/assets/discord-status.png" alt="Discord status preview" width="49%">
</p>

<p align="center">
  <img src="docs/assets/settings.png" alt="Companion settings" width="49%">
  <img src="docs/assets/manual-mode.png" alt="Manual mode" width="49%">
</p>

## Supported Sites

YouTube, Netflix, Spotify, Twitch, Discord, GitHub, ChatGPT, Google Meet, Crunchyroll, Hotstar, Wikipedia, Google Search, and manual custom status.

Site toggles in the popup enable or disable these existing detectors. Adding a brand-new site still requires adding detector code.

## Why A Companion App Exists

Chrome extensions cannot directly talk to Discord's local RPC socket. Activity Status uses:

```text
Chrome tab -> content script -> extension background -> local companion -> Discord desktop
```

The default local backend URL is:

```text
http://localhost:17654
```

If that port is busy, the companion tries a safe fallback and the extension auto-discovers it.

## Local Development

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
```

Run the companion locally:

```bash
npm run companion:dev
```

Package the Chrome Web Store zip:

```bash
npm run package:webstore
```

The upload file is created at:

```text
dist/discord-status-webstore.zip
```

## Release

GitHub Actions publishes full releases only when a version tag is pushed:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Release assets include the companion installers, manual extension zip, Chrome Web Store zip, and checksums.

## Discord Assets

Static Rich Presence logo assets live in:

```text
discord-assets-real/
```

Upload them in Discord Developer Portal with the exact keys listed in:

```text
discord-assets-real/UPLOAD_KEYS.txt
```

Dynamic thumbnails are different from uploaded assets. Some Discord RPC clients can pass external image references or resolved media proxy URLs, but compatibility depends on the RPC library and Discord behavior. For public extension reliability, static uploaded asset keys are still the safest default.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Extension says backend offline | Start Activity Status Companion and check the backend URL is `http://localhost:17654` |
| Discord RPC disconnected | Open Discord desktop, then click Reconnect Discord RPC in the companion |
| macOS says the app is damaged | Run `sudo xattr -cr "/Applications/Activity Status Companion.app"` after installing |
| Auto mode swaps tabs | Use Active Tab Only mode in the extension popup |
| Site is not detected | Make sure it is enabled in popup site toggles and reload that tab |

## Support

Report issues or feature requests here:

[GitHub Issues](https://github.com/GSUS2K/discord-status/issues)
