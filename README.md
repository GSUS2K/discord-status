# Discord Status

Show supported Chrome activity, system apps, games, or custom activity as Discord Rich Presence through a small local companion app.

Discord Status has two parts:

* **Chrome extension**: detects supported browser activity like YouTube, Netflix, Spotify, GitHub, ChatGPT, and more.
* **Companion app**: runs locally on your computer and updates Discord Rich Presence through Discord desktop.

The companion app can also work without the Chrome extension for manual custom status, supported system apps, and games.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/discord-status/ekobpekegflobmheipgceigkldggkakd?hl=en"><img alt="Chrome Web Store" src="https://img.shields.io/badge/install-chrome%20web%20store-5865F2?style=for-the-badge&labelColor=1b1f23"></a>
  <a href="https://github.com/GSUS2K/discord-status/releases/latest"><img alt="Latest companion release" src="https://img.shields.io/github/v/release/GSUS2K/discord-status?style=for-the-badge&label=companion"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/GSUS2K/discord-status?style=for-the-badge"></a>
</p>

![Discord Status preview](docs/assets/hero.png)

## Install

### Extension + Companion

1. Install the [Chrome extension](https://chromewebstore.google.com/detail/discord-status/ekobpekegflobmheipgceigkldggkakd?hl=en).
2. Install the [companion app](https://github.com/GSUS2K/discord-status/releases/latest).
3. Open Discord desktop and keep the companion running in the menu bar/system tray.

The extension detects browser activity. The companion runs on `localhost`, chooses the active status, and sends it to Discord desktop.

### Companion Only

You can also use only the companion app for:

* Manual custom Discord status
* Supported system apps
* Supported games
* Activity selection
* Discord RPC reconnect/diagnostics

The Chrome extension is only needed for browser tab detection.

## Download Companion App

Go to the [latest release](https://github.com/GSUS2K/discord-status/releases/latest) and download the file for your system.

| Platform            | Download                                           |
| ------------------- | -------------------------------------------------- |
| Windows             | `Discord-Status-Companion-Windows-Setup.exe`       |
| Windows MSI         | `Discord-Status-Companion-Windows.msi`             |
| macOS Apple Silicon | `Discord-Status-Companion-macOS-Apple-Silicon.dmg` |
| macOS Intel         | `Discord-Status-Companion-macOS-Intel.dmg`         |
| Linux AppImage      | `Discord-Status-Companion-Linux.AppImage`          |
| Linux Debian/Ubuntu | `Discord-Status-Companion-Linux.deb`               |

The Chrome extension is for browser activity detection. The companion app is required to update Discord Rich Presence.

## Features

| Feature                    | What it does                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser activity detection | Detects supported Chrome tab activity and sends it to the companion.                                                                                  |
| Discord Rich Presence      | Updates Discord desktop with your current activity.                                                                                                   |
| Companion-only mode        | Use manual custom status, supported system apps, or games without the Chrome extension.                                                               |
| Manual custom status       | Set your own Discord Rich Presence directly from the companion.                                                                                       |
| Activity inbox             | Sends all detected browser activities to the companion so one can be selected for Discord.                                                            |
| Quick selector             | Press `CommandOrControl+Shift+Y` to open a Spotlight-style picker, or click Auto mode to return control to the active tab.                            |
| Companion shortcuts        | Change the selector shortcut and settings shortcut in Companion Settings. Defaults are `CommandOrControl+Shift+Y` and `CommandOrControl+Alt+Shift+S`. |
| Two-way mode sync          | Selecting a status in the companion automatically puts the extension popup in Manual mode; Auto mode clears the companion override.                   |
| Version check              | The popup shows whether the installed extension and companion versions match.                                                                         |
| Active Tab Only            | Prevents background tabs from taking over your status.                                                                                                |
| System app picker          | Detects running desktop apps in the companion and lets you allow/select apps for Discord status.                                                      |
| Native activity labels     | Media is sent as Watching or Listening where Discord RPC supports it.                                                                                 |
| Privacy controls           | Private mode, platform-only mode, incognito blocking, blocked domains, and per-site toggles.                                                          |
| Companion diagnostics      | Shows backend, Discord RPC, extension connection, active port, logs, and copyable diagnostics.                                                        |
| System tray app            | Native Tauri companion for macOS, Windows, and Linux.                                                                                                 |

## Supported Activity

### Browser Activity

Media: YouTube, YouTube Music, Netflix, Prime Video, Hulu, Disney+, Apple TV, Hotstar, Crunchyroll, Spotify, SoundCloud, Apple Music, Bandcamp, Twitch.

Work/dev: GitHub, VS Code Web, Linear, Jira, Notion, Google Docs, Figma, Canva, ChatGPT, Google Meet.

Learning/social/gaming: Coursera, Udemy, Khan Academy, LeetCode, Reddit, X/Twitter, Instagram, LinkedIn, Steam, Chess.com, Lichess, Skribbl.io, GeoGuessr, Wikipedia, Google Search.

### Companion Activity

The companion app can also show manual custom status, supported desktop apps, and supported games without the Chrome extension.

System app detection runs locally on your computer.

## How It Works

Browser activity flow:

```text
Chrome tab -> extension -> localhost companion -> Discord desktop
```

Companion-only flow:

```text
System app/manual status -> companion -> Discord desktop
```

Default companion URL:

```text
http://localhost:17654
```

Discord Rich Presence runs locally through Discord desktop, so the Chrome extension alone cannot update Discord status. The companion app is required for Discord RPC.

Discord Rich Presence supports HTTPS image URLs for large artwork, so media thumbnails are used when the detected URL is public and short enough for Discord RPC. If that fails or a site does not expose artwork, Discord falls back to uploaded asset keys. Upload assets from `discord-assets-real/` and keep keys in sync with `discord-assets-real/UPLOAD_KEYS.txt` plus any packs in `discord-assets-real/more-discord-assets-*`.

Discord still owns the app identity shown on the card. The companion can send labels like Watching or Listening, but it cannot fully remove the Discord Developer Portal application name from every Discord surface.

The extension uses Chrome's `scripting` permission only to wake detectors in already-open supported tabs. This avoids forcing users to refresh YouTube, Netflix, Spotify, and other sites after installing, updating, or toggling the extension.

## Local Development

```bash
npm install
npm run check
~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml
npm run companion:dev
```

Package the Chrome Web Store zip:

```bash
npm run package:webstore
```

Upload:

```text
dist/discord-status-webstore.zip
```

## Release

```bash
git tag v1.0.33
git push origin main
git push origin v1.0.33
```

GitHub Actions builds the companion installers and attaches them to the release.

## Troubleshooting

| Problem                                  | Fix                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Extension says backend offline           | Open the companion and confirm the backend URL.                                                                          |
| Companion is not detected                | Make sure the companion app is running and the backend URL is `http://localhost:17654`.                                  |
| Discord RPC disconnected                 | Close and reopen Discord desktop, then reconnect Discord from the companion and extension.                               |
| Discord still shows disconnected         | Open Discord desktop first, then click Fix Connection/Reconnect Discord in the companion.                                |
| Wrong activity is showing                | Refresh the web page and check whether Auto mode, Manual mode, or Active Tab Only is selected correctly.                 |
| Wrong thumbnail or icon is showing       | Refresh the web page. If Discord does not accept the detected image URL, it may fall back to the uploaded platform icon. |
| Auto mode swaps tabs                     | Enable Active Tab Only mode.                                                                                             |
| Status not swapping to system app        | Close or switch extension mode to manual.                                                                                |
| Companion does not show browser activity | Confirm the extension is installed, enabled, and allowed on the current site.                                            |
| Companion-only status is not showing     | Open Discord desktop and check Discord RPC connection in the companion.                                                  |
| Status is too detailed                   | Use platform-only mode or disable that site.                                                                             |
| Discord shows the app logo               | Upload the matching Discord asset key and wait for cache refresh.                                                        |
| macOS says app is damaged                | Run `sudo xattr -cr "/Applications/Activity Status Companion.app"`.                                                      |

## Support

Issues and feature requests: [GitHub Issues](https://github.com/GSUS2K/discord-status/issues)
