# Discord Status

Show your Chrome activity as Discord Rich Presence. Works with media, coding, learning, social, and productivity sites through a small local companion app.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/ekobpekegflobmheipgceigkldggkakd"><img alt="Chrome Web Store" src="https://img.shields.io/badge/install-chrome%20web%20store-5865F2?style=for-the-badge&labelColor=1b1f23"></a>
  <a href="https://github.com/GSUS2K/discord-status/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/GSUS2K/discord-status?style=for-the-badge&label=companion"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/GSUS2K/discord-status?style=for-the-badge"></a>
</p>

![Discord Status preview](docs/assets/hero.png)

## Install In 3 Steps

1. Install the [Chrome extension](https://chromewebstore.google.com/detail/ekobpekegflobmheipgceigkldggkakd).
2. Install the [Activity Status Companion app](https://github.com/GSUS2K/discord-status/releases/latest).
3. Open Discord desktop and keep the companion running in the menu bar/system tray.

The extension detects browser activity. The companion runs locally on your computer and sends the selected activity to Discord.

## What It Does

| Area | Details |
| --- | --- |
| Activity inbox | The extension sends all detected activities to the companion, and the companion chooses what Discord shows. |
| Smart selection | Prioritizes the current Chrome tab. Active Tab Only mode ignores background tabs. |
| Privacy controls | Private mode, platform-only mode, incognito blocking, blocked domains, and media-only-while-playing rules. |
| Site toggles | Enable or disable supported sites directly from the popup or settings page. |
| Companion diagnostics | Backend status, Discord RPC status, extension connection, active port, system app detection, and copy diagnostics. |
| Native tray app | macOS menu bar, Windows tray, and Linux tray builds using Tauri. |

## Supported Sites

Media: YouTube, YouTube Music, Netflix, Prime Video, Hulu, Disney+, Apple TV, Hotstar, Crunchyroll, Spotify, SoundCloud, Apple Music, Bandcamp, Twitch.

Work/dev: GitHub, VS Code Web, Linear, Jira, Notion, Google Docs, Figma, Canva, ChatGPT, Google Meet.

Learning/social/gaming: Coursera, Udemy, Khan Academy, LeetCode, Reddit, X/Twitter, Instagram, LinkedIn, Steam, Chess.com, Lichess, Skribbl.io, GeoGuessr, Wikipedia, Google Search.

More sites can be added by adding a detector and host permissions.

## How It Works

```text
Chrome tab -> content script -> extension background -> localhost companion -> Discord desktop
```

Default companion URL:

```text
http://localhost:17654
```

If the port is busy, the companion can move to a fallback port and the extension auto-discovers it.

## Screenshots

Add updated screenshots here:

<p align="center">
  <img src="docs/assets/popup.png" alt="Extension popup" width="49%">
  <img src="docs/assets/discord-status.png" alt="Discord status preview" width="49%">
</p>

<p align="center">
  <img src="docs/assets/settings.png" alt="Companion settings" width="49%">
  <img src="docs/assets/manual-mode.png" alt="Manual mode" width="49%">
</p>

## Local Development

```bash
npm install
npm run check
~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml
npm run companion:dev
```

Package the Chrome Web Store upload:

```bash
npm run package:webstore
```

Upload file:

```text
dist/discord-status-webstore.zip
```

## Release

```bash
git tag v1.0.19
git push origin main
git push origin v1.0.19
```

GitHub Actions builds the companion app and attaches installers to the release.

## Discord Assets

Discord Rich Presence images must use uploaded asset keys. Upload PNG assets from `discord-assets-real/` in Discord Developer Portal and keep the keys listed in `discord-assets-real/UPLOAD_KEYS.txt`.

Dynamic video thumbnails are captured as metadata, but the public build uses stable uploaded site/logo assets because Discord RPC can fall back to the app icon when an image key is not accepted.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Extension says backend offline | Open Activity Status Companion and check the backend URL. |
| Discord RPC disconnected | Open Discord desktop, then click Fix Connection in the companion. |
| Auto mode swaps tabs | Use Active Tab Only mode in the popup. |
| A site is too private | Use platform-only mode, block the domain, or disable the site. |
| macOS says app is damaged | Run `sudo xattr -cr "/Applications/Activity Status Companion.app"` after installing. |

## Support

Issues and feature requests: [GitHub Issues](https://github.com/GSUS2K/discord-status/issues)
