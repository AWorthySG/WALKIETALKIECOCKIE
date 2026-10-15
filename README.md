# Cockie Talkie

Shared internet walkie-talkie channels, with a browser app and Flutter source for iPhone and Android.

**Open:** https://relay-walkie-api.jeremylimguanfong.workers.dev

Enter your name, choose one of 20 shared channels and tap **Tune in**. Everyone on the same channel number hears each other. Share or Copy sends a `#channel=N` link that preselects the channel. Hold the round button to talk; release it to listen. On desktop, Space also works. The browser asks for microphone access when you tune in, so the first press is not interrupted by the prompt. If sound is blocked by the browser, tap **Enable sound**.

The browser app uses numbered channels only. The server still accepts the older private create/join-by-code routes, which the Flutter source uses.

## Sticker artwork

The supplied Cockie Talkie sausage sticker is used for the app logo, opening cover, installation artwork, browser favicon, Android maskable Home Screen icon and iPhone Home Screen icon. The original image is preserved at `branding/sticker-original.png`.

Run `npm run build:branding` to regenerate cover images and icon sizes, then `npm run build` to bundle the web release. Native launcher icon sets are included under `mobile/assets/app-icons`; `scripts/setup_mobile.sh` copies them into the generated Android and iOS projects. The Flutter opening screen and header also use the sticker asset.

Existing iPhone Home Screen shortcuts may retain their old icon. Remove the shortcut and add it again to pick up the sticker. Android icon updates are controlled by the browser and may take time.

## Install on the Home Screen

Open the app and tap **Install app**. The installation guide provides iPhone/iPad and Android steps, detects the current phone platform, and offers the browser's native install prompt when available. On iPhone, use Safari > Share > Add to Home Screen, leaving Open as Web App on if shown. On Android, use Chrome's install prompt or menu > Install app / Add to Home screen. Installation requires the user's confirmation on each device.

A standalone manifest, Android maskable icon, 180-pixel Apple touch icon, Apple web-app name and offline shell are included. Installed app windows hide the install buttons. Launching from the icon opens a standalone web app, with the same internet and background limits as the browser version. This is Home Screen web-app installation; no native APK or IPA is required or included.

## Background listening and typography

The app is named **Cockie Talkie**, with locally bundled Nunito fonts in the web and Flutter apps. The existing address and private channel identities are retained.

While connected, switch on **Background listening** to keep receiving incoming speech when switching away. The microphone is stopped whenever the app loses foreground focus. There are no idle sounds, silent audio loops, pings or alert tones. Turning off Sound also silences incoming background transmissions. Leaving the channel switches off background listening. This preference is deliberately off for each new channel session.

- **Web / home-screen app:** the connection is retained while the browser allows it, and incoming remote audio remains audible when the option is on. When off, remote audio is muted while the page is hidden and restored on return. Closing the page ends the call. No browser setting can guarantee indefinite background execution or locked-screen reception.
- **Native Android source:** the option starts an Android mediaPlayback foreground service with a partial wake lock and Wi-Fi lock, subject to granted permissions. A persistent, silent notification identifies the listening session. A vendored MIT-licensed flutter_background 1.3.1 plugin is adapted to suppress notification sound and vibration. Turning the option off or leaving stops the service. Force-stop, process death, lost internet and device power management can still interrupt reception. Service restart does not reconstruct a private channel after process death.
- **Native iPhone source:** the option retains remote audio with the existing iOS background-audio capability. This remains best effort; full native Push to Talk / push activation is not implemented, so reception after suspension or termination is not guaranteed.

Android and iPhone behaviour is not compiled or physically tested in this environment. The setup script adds Android service permissions and declarations and iOS background-audio configuration; an idempotency test checks the generated metadata.

## Type a voice message

In a connected channel, use **Type a voice message**, enter up to 300 characters in English, and tap **Send as voice**. The server converts the text into MP3 audio. The sender transmits that audio as a LiveKit track, so other connected browser and Flutter participants hear an ordinary radio transmission. The sender's physical microphone is never enabled for this feature.

The message uses the existing speaking lease. If another person is already speaking when it is ready, the draft is kept and the sender can try again. **Stop voice message**, leaving the screen, losing the connection, or a failed lease renewal stops playback and releases the floor. Messages are live only, with no inbox or replay. Transmitted is not a delivery or listening receipt.

Cloudflare's `AI` binding runs `@cf/deepgram/aura-2-en`. It requires Workers AI access and consumes speech-generation usage on the Cloudflare account. No separate speech API key is needed. The endpoint checks channel authentication, limits input to 300 characters and allows six generations per channel per minute. Generated audio is not stored by the app, and responses use `no-store`.

Native Flutter apps can receive this audio with their existing voice receiver. The text composer is currently in the web app; no native Flutter text composer is included.

## Version 2.5.2: push-to-talk repair

Version 2.5.1, as deployed, served a broken `/app.js`. About 72 KB of the bundle had been replaced by the text `... 71755 bytes omitted ...`, so the browser rejected the whole script with `missing ) after argument list`. No app code ran: Tune in reloaded the page and the talk button stayed disabled. The 2.5.1 client source was not in the archive. It has been rebuilt from the 2.4.0 client and the deployed 2.5.1 HTML, CSS and Worker.

Changes:

- `/v1/channels/tune` and shared channels 1 to 20 are now in `cloudflare/worker.js`, matching the deployed 2.5.1 Worker.
- Lease timing uses the server's `leaseDurationMs` with the phone's own clock. Previously, a phone clock more than about 12 seconds ahead of the server cancelled every press without an error.
- Pressing again while the previous turn is still being released now starts a new turn, instead of being ignored.
- Microphone permission is requested at Tune in, not on the first press.
- `npm run build` fails if either bundle contains a truncation marker or does not parse. `scripts/verify_live.mjs` applies the same check to the deployed `/app.js`.

## Included

- Phone-friendly web interface, bundled LiveKit SDK and installable home-screen app shell.
- Twenty shared numbered channels, channel links, sharing and copying.
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
npx wrangler deploy --config cloudflare/wrangler.toml
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
