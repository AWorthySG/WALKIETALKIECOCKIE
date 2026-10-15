#!/usr/bin/env python3
"""Create a local, untracked backend .env. Never print or package secrets."""
from pathlib import Path
from getpass import getpass
import secrets
import os
import sys

root = Path(__file__).resolve().parents[1]
dest = root / 'backend' / '.env'
if dest.exists():
    print('backend/.env already exists. Refusing to overwrite it.')
    sys.exit(1)
print('Configure the private Relay backend. Values are stored locally, not in the app.')
url = input('LiveKit WebSocket URL [wss://walkie-talkie-cockie-1d244eqd.livekit.cloud]: ').strip() or 'wss://walkie-talkie-cockie-1d244eqd.livekit.cloud'
key = input('LiveKit API key: ').strip()
secret = getpass('LiveKit API secret (input hidden): ').strip()
if not url.startswith('wss://') or not key or not secret or any('\n' in v or '\r' in v for v in (url,key,secret)):
    sys.exit('Invalid URL, key or secret.')
values = {
    'LIVEKIT_URL': url,
    'LIVEKIT_API_KEY': key,
    'LIVEKIT_API_SECRET': secret,
    'APP_SESSION_SECRET': secrets.token_hex(32),
    'PORT': '8787',
    'DATA_FILE': './data/channels.json',
}
fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as f:
    for name, value in values.items():
        f.write(f'{name}={value}\n')
print('Created backend/.env with restricted file permissions. Do not commit or share it.')
