# Cockie Talkie

Private family walkie-talkie channels, with a browser app and Flutter source for iPhone and Android.

**Open:** https://relay-walkie-api.jeremylimguanfong.workers.dev

Enter your name and tap **Start channel**. Open **More options** to share the invite link or code with your family; they open the link, enter their name and tap **Join channel**. Only people with the invite code can join.

After the first time, the phone remembers the channel and opens straight into it. **Leave this channel** (under More options) makes the phone forget it.

Tap the round button to talk and tap it again to stop. A transmission stops by itself after one minute. To hold the button while talking instead, switch on **Hold the button to talk** under More options. On desktop, Space also works.

**Quick messages** send a spoken message with one tap and no talking: "Can you come here, please?", "Please bring me some water.", "Baby is asleep. Please be quiet." and "I am okay. No need to come." A repeated quick message plays at once because its audio is kept for the session.

**Night mode** (top right) turns the screen dim red on black. The choice is remembered.

The browser asks for microphone access when you start or join, so the first tap is not interrupted by the prompt. If sound is blocked by the browser, tap **Tap to hear the channel**.

The numbered shared channels from 2.5 are no longer offered in the app. The server still accepts `/v1/channels/tune` for older clients.

## Version 2.6.0: easier to use

- Private family channels with invite codes, instead of shared numbered channels anyone could join.
- Opens straight into the saved channel.
- Tap to talk, with a one-minute limit. Hold-to-talk remains as an option.
- Four one-tap quick messages.
- Simpler main screen: status, talk button and quick messages. Everything else is under **More options**.
- Night mode and larger text.
- The Flutter app uses the same private channels.

## Version 2.5.2: push-to-talk repair

Version 2.5.1, as deployed, served a broken `/app.js`. About 72 KB of the bundle had been replaced by the text `... 71755 bytes omitted ...`, so the browser rejected the whole script with `missing ) after argument list`. No app code ran: Tune in reloaded the page and the talk button stayed disabled. The 2.5.1 client source was not in the archive. It has been rebuilt from the 2.4.0 client and the deployed 2.5.1 HTML, CSS and Worker.

Changes:

- `/v1/channels/tune` and shared channels 1 to 20 are now in `cloudflare/worker.js`, matching the deployed 2.5.1 Worker.
- Lease timing uses the server's `leaseDurationMs` with the phone's own clock. Previously, a phone clock more than about 12 seconds ahead of the server cancelled every press without an error.
- Pressing again while the previous turn is still being released now starts a new turn, instead of being ignored.
- Microphone permission is requested at Tune in, not on the first press.
- The Flutter app uses the same lease timing as the browser app.
- `npm run build` fails if either bundle contains a truncation marker or does not parse. `scripts/verify_live.mjs` applies the same check to the deployed `/app.js`.

## Included

- Phone-friendly web interface, bundled LiveKit SDK and installable home-screen app shell.
- Private family channels, invite links and codes, sharing and copying.
- Live participant and speaker indicators, sound toggle, automatic reconnect and explicit reconnect after disconnection.
- Server-coordinated speaking leases. Both browser and Flutter clients stop transmitting on release, loss of foreground focus, failed renewal or lease expiry.
- Session refresh, starting muted, microphone permission handling and screen wake lock where available.
- Cloudflare Durable Object persistence and atomic floor transactions; existing channels survive this upgrade.
- Actual request byte limits, strict token validation, same-origin browser API calls and a persistent per-IP channel-attempt limit.
- No API credentials in this source archive. Existing deployed secret bindings are retained.

## Run the checks and build

Node.js 22 or newer:

```sh
npm ci
npm test
npm run build
```

The build generates `cloudflare/assets.js` and the self-contained `dist/worker.js`; both are git-ignored and rebuilt by `npm test` and the Wrangler build hook. Icons are included as PNG and SVG assets. There are no external runtime script or font CDN requests.

To check an existing deployment:

```sh
node scripts/verify_live.mjs
```

This checks that the deployed `/app.js` is complete, tunes to channel 20, creates one private test channel, exercises its floor controls, and attempts a real LiveKit signalling join. It does not test audio playback or microphone capture.

## Deploy to Cloudflare

From the root, after installing Wrangler if needed:

```sh
npm run deploy
```

The Wrangler build hook runs the web build. The existing `RelayState` namespace and v1 migration are preserved. Set these private secrets on a fresh deployment:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `APP_SESSION_SECRET`

The LiveKit URL must use WSS. The session secret should be a long random value. Never put secret values into browser or Flutter source.

## Native Flutter app

Flutter 3.38+ / Dart 3.10+, plus Android SDK or Xcode:

```sh
./scripts/setup_mobile.sh
cd mobile
flutter analyze
flutter run --dart-define=API_BASE_URL=https://relay-walkie-api.jeremylimguanfong.workers.dev
```

For an Android release:

```sh
flutter build appbundle --release --dart-define=API_BASE_URL=https://relay-walkie-api.jeremylimguanfong.workers.dev
```

For iPhone, build and sign on macOS with Xcode:

```sh
flutter build ipa --release --dart-define=API_BASE_URL=https://relay-walkie-api.jeremylimguanfong.workers.dev
```

No APK or IPA is included. Native platform scaffolds are generated by the setup script. The legacy Node backend is retained as reference; the updated clients target Cloudflare, including its session-refresh endpoint.

## Verification and limits

See `cloudflare/DEPLOYMENT.md` for the exact checks completed on this release.

The browser app needs an internet connection for calls. Home-screen installation does not add native background or lock-screen PTT. Keep it open for reliable use; phone/browser power settings can interrupt reception. Native iOS system Push to Talk integration, wake-from-termination delivery and store distribution are not implemented. Android foreground listening is included in source and requires a native build and device verification.

Invite codes are bearer credentials: anyone with a code can join. There are no accounts, individual member controls or invite revocation. The speaking lock coordinates compliant clients; the media server does not enforce the lock against modified clients. Audio is encrypted in transit, with no end-to-end encryption configured. Audio is not recorded by this application.

This environment has no Flutter SDK. Flutter compilation and physical two-phone audio, Bluetooth and locked-screen behaviour have not been verified here. The browser UI was inspected, but the cloud browser could not maintain its LiveKit media connection, so a complete browser-to-browser transmission was not verified. Server speech generation was tested live and produced a decodable MP3.

## Source layout

| Path | Purpose |
| --- | --- |
| `web/` | Browser UI, microphone controller, install assets and service worker |
| `cloudflare/worker.js` | API, signing, rate limiting and durable floor control |
| `cloudflare/acceptance.test.mjs` | API, persistence interface and asset tests |
| `test/radio.test.mjs` | Microphone and network race tests |
| `scripts/build_web.mjs` | Reproducible SDK/client/Worker build |
| `scripts/verify_live.mjs` | Live API and LiveKit signalling check |
| `mobile/` | Flutter source and native configuration bootstrap |
| `backend/` | Original Node implementation and regression tests |
