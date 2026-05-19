# Chrome Web Store Checklist

Use this when publishing the public Chrome extension listing.

## Upload Package

Build the store zip:

```bash
npm install
npm run check
npm run package:webstore
```

Upload this file in the Chrome Web Store Developer Dashboard:

```text
dist/discord-status-webstore.zip
```

Do not upload `dist/activity-status-extension.zip` to the Chrome Web Store. That one is the GitHub/manual install bundle.

## Listing Copy

Name:

```text
Discord Status
```

Short description:

```text
Show YouTube, Netflix, Spotify, GitHub, ChatGPT and more as Discord Rich Presence.
```

Detailed description:

```text
Discord Status shows supported browser activity as a Discord Rich Presence status.

It can detect activity from supported sites like YouTube, Netflix, Spotify, Twitch, GitHub, ChatGPT, Google Meet, Crunchyroll, Hotstar, Google Search, and Wikipedia. You can also set a manual title and message from the popup.

Discord Rich Presence requires a local desktop bridge, so the extension is designed to be used with Activity Status Companion. The companion app runs on your computer, talks to the Discord desktop app locally, and does not require users to create their own Discord developer application.
```

Single purpose:

```text
Display supported browser activity in Discord Rich Presence through a local companion app.
```

Category:

```text
Social & Communication
```

## Permission Notes

Use these explanations when the dashboard asks why permissions are needed:

| Permission | Reason |
| --- | --- |
| `tabs` | Reads the active tab URL/title and keeps auto detect focused on the tab the user is viewing |
| `storage` | Saves settings, selected mode, detected activity, and local diagnostic logs |
| Host permissions for supported sites | Allows content scripts to detect activity on the supported websites |
| `localhost` / `127.0.0.1` host access | Sends activity to the local Activity Status Companion app |

## Privacy Notes

Suggested privacy statement:

```text
Discord Status stores settings and diagnostic logs locally in Chrome storage. It sends detected activity only to the local Activity Status Companion app running on the user's computer. The extension does not sell data, does not use activity for advertising, and does not send browsing activity to an external analytics server.
```

Mention that the companion app forwards the current activity to Discord through Discord's local Rich Presence connection.

## Updating After Publish

Yes, you can change the code later.

1. Make the code change.
2. Increase `version` in `extension/manifest.json`.
3. Run `npm run check`.
4. Run `npm run package:webstore`.
5. Upload the new `dist/discord-status-webstore.zip`.
6. Submit the update for review.

Chrome will update users after the new version is approved.

## Screenshots

Leave room for these in the listing:

- Popup showing connected status
- Discord profile/activity card preview
- Manual mode with custom title/message
- Settings page showing supported-site checkboxes

Use screenshots that show the extension name **Discord Status** and the Discord card name **Activity Status**.
