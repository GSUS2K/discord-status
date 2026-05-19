#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install it from https://nodejs.org/ and run this again."
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ is required. Current version: $(node -v)"
  exit 1
fi

echo "Installing backend dependencies..."
npm --prefix "$BACKEND_DIR" install

if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo
  echo "Created backend/.env."
  echo "Edit backend/.env and set DISCORD_CLIENT_ID before starting the backend."
fi

echo
echo "Next steps:"
echo "1. Upload discord-assets-real/*.png to your Discord app Rich Presence assets."
echo "2. Set DISCORD_CLIENT_ID in backend/.env."
echo "3. Run: npm start"
echo "4. Load the extension folder in chrome://extensions."
