# native/: the installable apps

Both apps are thin shells around the live site. Features belong in `apps/web` and
never here. This folder holds only what the site cannot do from inside a browser
tab. Installing and releasing: `docs/apps.md`.

## desktop/: Windows, Mac and Linux (Electron)

```bash
cd native/desktop && npm install
npm start                                                  # the live site
STUDIO_AUTOPILOT_URL=http://localhost:5199 npx electron .  # a local web build
npx electron-builder --linux --publish never               # dist/*.AppImage, *.deb
```

It is not a bun workspace: Electron and electron-builder stay out of the web app's
install. `package-lock.json` pins them for CI (`npm ci`).

| File | What it decides |
|---|---|
| `src/main.cjs` | windows, permissions (only our site gets the microphone, location and notifications), downloads, the offline page, deep links, the menu actions |
| `src/links.cjs` | where an address opens: in the app, an in-app sign-in popup, or outside (WhatsApp, mail, the dialler, another site). Tested in `test/links.test.ts` (root `bun run test`). |
| `src/preload.cjs` | all the page learns: `window.studioAutopilotDesktop = { isDesktop, platform, version }` |
| `src/menu.cjs`, `src/context-menu.cjs` | the menu bar, and right-click (spelling, copy link, paste) |
| `src/offline.html` | "You're offline": retries on the `online` event and every 15 s |
| `scripts/after-pack.cjs` | ad-hoc signs the Mac app, so it opens after one "Open Anyway" instead of being refused as "damaged" |

The web app opens WhatsApp and the gallery with `window.open('')`, then sets
`tab.location` once the server answers. A browser would block a window opened after
the wait. The shell keeps that empty window hidden and decides on its first
navigation. Stopping that navigation from `did-start-navigation` crashes Electron 44
(SIGTRAP), so a window bound elsewhere is destroyed instead, and `will-navigate`
cancels the rest.

## android/: Android (a Trusted Web Activity)

`bash native/android/build.sh` (needs `ANDROID_HOME` and a JDK). It uses only
the SDK's own tools: aidl, aapt2, javac, d8, zipalign and apksigner. There is no
Gradle and no Google Maven, so it builds the same offline as in CI.

- `app/java/.../LauncherActivity.java` binds the browser's Custom Tabs service,
  opens a session and launches the site as a Trusted Web Activity. These are the
  calls androidx.browser and android-browser-helper make, written out by hand so
  nothing has to be downloaded.
- `BrowserPicker.java` picks the browser: the default one if it can run the app,
  then Chrome, then any other that can. If none can, a Custom Tab, then any browser.
- `app/aidl/android/support/customtabs/*.aidl` are copied unchanged from
  androidx.browser (Apache 2.0), except for an androidx-only annotation that was
  dropped. The binder transaction codes must match the browser's own.
- `make-icons.py` redraws the launcher icons and splash logo from
  `apps/web/public/icons`.
- The site's half of the trust is `apps/web/public/.well-known/assetlinks.json`.
  Its fingerprint must be the release key's.

There is no location or notification delegation service. Chrome asks for
location and shows notifications itself, as it does on the website.
