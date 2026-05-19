# Browser Presence

Show supported browser activity in Discord Rich Presence from a Chrome extension.

Browser Presence detects activity on sites like YouTube, Netflix, Spotify, Twitch, GitHub, ChatGPT, Google Meet, Crunchyroll, Hotstar, Google, and Wikipedia, then sends that activity to a small local backend that talks to the Discord desktop app.

## Why A Backend Is Required

Chrome extensions cannot talk directly to Discord's local IPC/RPC socket. Discord Rich Presence needs a local process running on the same computer as the Discord desktop app, so this project has two pieces:

- `extension/`: the Chrome extension that detects browser activity.
- `backend/`: the local Node.js Discord RPC bridge.

That means a totally zero-setup GitHub download is not realistic for normal users. The closest safe flow is: download, run the installer, add a Discord app client ID, start the backend, then load the extension.

## Quick Start

1. Install Node.js 18 or newer.
2. Create a Discord app at [Discord Developer Portal](https://discord.com/developers/applications).
3. Rename the app to something like `Browser Presence`.
4. Upload the PNGs in `discord-assets-real/` under **Rich Presence > Art Assets** using the exact keys in `discord-assets-real/UPLOAD_KEYS.txt`.
5. Run the installer:

```bash
./install.sh
```

6. Edit `backend/.env`:

```env
DISCORD_CLIENT_ID=your_discord_application_client_id
PORT=3000
LOG_LEVEL=info
ENABLE_PRESENCE_BUTTONS=true
```

7. Start the backend:

```bash
npm start
```

8. Open Chrome at `chrome://extensions`, enable Developer Mode, click **Load unpacked**, and select the `extension/` folder.

## Packaging For GitHub Releases

Build a downloadable zip:

```bash
npm run package
```

The zip is written to:

```text
dist/browser-presence-extension.zip
```

GitHub Actions also builds this zip as an artifact on pushes and pull requests.

## Asset Keys

Upload these files from `discord-assets-real/` to your Discord app with these exact keys:

```text
youtube      -> youtube.png
netflix      -> netflix.png
spotify      -> spotify.png
twitch       -> twitch.png
discord      -> discord.png
meet         -> meet.png
github       -> github.png
chatgpt      -> chatgpt.png
hotstar      -> hotstar.png
crunchyroll  -> crunchyroll.png
wikipedia    -> wikipedia.png
google       -> google.png
```

Discord can take a few minutes to refresh newly uploaded Rich Presence assets.

## Development

Run checks:

```bash
npm run check
```

Start backend:

```bash
npm start
```

Backend status:

```bash
curl http://localhost:3000/api/status
```

## Notes For Users

- The Discord desktop app must be running.
- The backend must run locally; deploying it to Railway/Fly/Render will not control your local Discord status.
- Chrome Web Store distribution would make extension installation easier, but users still need the local backend.
- A future native desktop helper could make this closer to one-click installation.
