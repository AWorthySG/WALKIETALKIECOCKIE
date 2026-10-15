# Relay v2 deployment record

Date: 15 October 2026

App and API: https://relay-walkie-api.jeremylimguanfong.workers.dev

Cloudflare Worker: `relay-walkie-api`
Deployment ID: `3737475b83424246970d32c65a40fdf0`
Existing SQLite Durable Object binding: `RELAY_STATE` / `RelayState`; migration `v1` retained.
All four existing secret bindings were retained and their names verified after deployment. No secret values were read or placed in this archive.

## Completed

- Browser SDK bundle and self-contained Worker build.
- 14 automated API and microphone race tests passed.
- Five legacy Node backend regression tests passed.
- Live app HTML, JavaScript, CSS, PNG icon, manifest, service worker and health returned HTTP 200.
- Live channel creation and joining with an invite code passed.
- Live floor claim, exclusion of another speaker, lease renewal and release passed.
- Live session refresh preserved participant identity; invalid authentication was rejected.
- LiveKit accepted the deployed server's participant token and returned a real room join response over WebSocket.
- Cloudflare confirmed the uploaded version and preserved namespace and secret bindings.

## Not verified here

- Browser interaction and visual layout in a running browser.
- Physical phone-to-phone microphone capture and audio reception.
- Bluetooth, interruption, locked-screen and background behaviour.
- Flutter analysis, compilation, signed native distribution and store installation. No Flutter SDK is installed in this environment.

## First phone check

1. Open the app link on two phones in Safari or Chrome.
2. Create a channel on one phone and share the invite link to the other.
3. Join with a different name. Allow microphone access when prompted.
4. Tap Enable sound if it appears.
5. Hold to speak on the first phone; confirm the other phone hears it.
6. Release and repeat in the other direction.
7. Try pressing both buttons together; only one cooperating client should transmit.
8. Switch away while transmitting; confirm transmission stops.
9. Switch networks and confirm reconnection, then test Bluetooth if needed.

Home-screen installation is available through the browser. It does not supply native lock-screen push-to-talk.

## v2.1 text-to-voice update

The authenticated `/v1/speech` endpoint generated 13,824 bytes of valid MP3 audio in a live check (24 kHz, 2.304 seconds for the test sentence). The updated client publishes generated audio through LiveKit using the microphone track source, without capturing the physical microphone. The AI binding was added while retaining all existing secrets and Durable Object state.

22 API and controller tests passed, including speech validation, channel-wide rate limiting, stopping during a pending claim, failed track publication, failed playback start and exclusion of overlapping local transmissions. Five original Node tests also passed.

The deployed browser UI was inspected and the new text composer was visible. The cloud browser could not maintain the LiveKit media connection and remained in reconnection, so actual receiver playback remains unverified in this environment. Check on two phones before relying on it.

Final v2.1 deployment ID: `d8b68a312ef549bd9d4f0b07574b6eea`.

## v2.2 Cockie Talkie update

Renamed the web app, manifest, native app labels and sharing text to Cockie Talkie. Bundled Nunito fonts locally for browser and native Flutter use. Added an explicit background-listening toggle with foreground/hidden audio policy, quiet idle behaviour and foreground-only transmission. Added Android foreground-service support and a silent notification to the native source; iOS retains its background-audio capability.

26 API/controller/configuration tests and five legacy regression tests passed. Native compilation and physical background/locked-screen reception are unverified. Browser background execution remains best effort.

Cockie Talkie v2.2 deployment ID: `669cceb83831444698bd3f88386e523c`. Live browser inspection confirmed the renamed page and Nunito computed styling across body text, headings, links, buttons and fields.

## v2.3 Home Screen installation

Added a visible install card, platform-specific installation dialog, Android native-prompt support when offered by the browser, iOS Safari instructions and standalone-mode detection. Added a 180x180 Apple touch icon and 512x512 maskable Android icon, plus offline caching for both. Thirty API/client/configuration tests and five legacy regression tests passed. Actual Home Screen installation on physical phones is not performed in this environment.

Final v2.3 deployment ID: `d4adac5e4e2b4e99a0859548349ae569`. Live browser checks confirmed the install card, installation dialog and both Android and iPhone instruction tabs.

## v2.4 supplied sticker branding

Deployment ID: `382e33772eee43bc94ada5c689b66dda`. The supplied sausage sticker is now the header logo, opening cover, browser icon, install artwork and Android/iPhone Home Screen icon. Padded Android maskable and native Android/iOS launcher assets are included. The original sticker is preserved unchanged.

30 API/controller/configuration tests passed. A live browser inspection confirmed the sticker cover and logo loaded successfully and the Apple touch icon references the new artwork. Native launcher assets are prepared in source but native builds and physical Home Screen updates remain unverified. Existing installed shortcuts may need removing and adding again.

## v2.5.2 push-to-talk repair (not yet deployed)

The deployed v2.5.1 `/app.js` contained the literal text `... 71755 bytes omitted ...` in place of part of the bundle. Chromium reported `missing ) after argument list` on the live page, and Tune in did nothing. The deployed Worker was retrieved from Cloudflare; its server logic was intact and is now in `cloudflare/worker.js`.

Checked in this environment:

- 37 API, controller, configuration and bundle tests passed. Five legacy Node tests passed.
- The build check rejects a truncated or unparseable bundle.
- Two headless Chromium pages, using the rebuilt client and the live API, tuned to channel 19 and connected to LiveKit. Holding the button on the first page showed TRANSMITTING and Microphone live. The second page showed NOW TRANSMITTING, named the speaker and received one remote audio track. Release returned to HOLD TO TALK. A re-press 150 ms after release transmitted again.

Not checked: deployment, physical phones, audible playback and Flutter builds.

Deploy with `npx wrangler deploy --config cloudflare/wrangler.toml`, then run `node scripts/verify_live.mjs`. It expects version 2.5.2.
