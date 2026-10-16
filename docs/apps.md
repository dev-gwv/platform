# Studio AutoPilot apps: Windows, Mac, Linux and Android

Each app opens **the live site** (studioautopilot.in) in a window of its own. Every
feature the web app has is already in the apps, and every change we ship reaches
them the next time they open. Nobody has to reinstall anything.

A new app build is needed only when the app itself changes, for example its icon,
its name or how links open. That code lives in `native/`.

| | File | Size |
|---|---|---|
| Windows 10 / 11 | `Studio-AutoPilot-Setup-1.0.0-x64.exe` | ~90 MB |
| Mac with an Apple chip (M1–M4) | `Studio-AutoPilot-1.0.0-mac-arm64.dmg` | ~110 MB |
| Mac with an Intel chip | `Studio-AutoPilot-1.0.0-mac-x64.dmg` | ~115 MB |
| Linux | `.AppImage` (any distro) or `.deb` (Ubuntu) | ~100–125 MB |
| Android 5 and later | `Studio-AutoPilot-1.0.0.apk` | ~0.1 MB |

The Android app is tiny because it runs inside Chrome, which is already on the phone.

## Where the files come from

- **A push that changes `native/`** on any branch except main builds all of them,
  including a pull request's branch. Open **Actions → Apps**, pick the run, and
  scroll to **Artifacts**. The files stay there for 14 days.
- **A release.** Push a tag such as `apps-v1.0.1`, or go to **Actions → Apps → Run
  workflow**. The tag also creates a GitHub Release with every file attached.
- The repository is private, so studios cannot download from GitHub. Put the files
  somewhere they can reach, such as Google Drive with "Anyone with the link", and
  share that link.

## Installing

### Windows
1. Double-click the `.exe` file.
2. Windows may show **"Windows protected your PC"**, because the app is not yet
   signed with a paid code-signing certificate. Press **More info**, then **Run anyway**.
3. The app installs in a few seconds and opens. It adds a desktop icon and a Start
   menu entry. To remove it, use **Settings → Apps**.

### Mac
1. Open the `.dmg` and drag **Studio AutoPilot** into **Applications**.
2. The first time it opens, macOS says it "cannot verify the developer". Press
   **Done**. Then open **System Settings → Privacy & Security**, scroll down, and
   press **Open Anyway** beside Studio AutoPilot. This happens once only.
3. Which file to use: **Apple menu → About This Mac**. If it says "Chip: Apple M…",
   use `arm64`. If it says "Processor: Intel…", use `x64`.

If the studio buys an Apple Developer ID ($99 a year), the step-2 warning goes away.
Set `CSC_LINK` and `CSC_KEY_PASSWORD` in the workflow, and add notarisation.

### Android
1. Send the `.apk` on WhatsApp, or put it on Drive, and open it on the phone.
2. Android asks to **allow installs from this source** (WhatsApp, Files or Chrome).
   Allow it, then press **Install**. Play Protect may say the app is unknown; press
   **Install anyway**.
3. Open **Studio AutoPilot** from the home screen. The first time, Chrome shows a
   small "Running in Chrome" note.

The app needs Google Chrome (or Edge or Samsung Internet), as almost every Android
phone has. Without one of them, it opens the site in whatever browser the phone has.

## What works where

| | Desktop apps | Android app |
|---|---|---|
| Every page and feature of the site | ✓ | ✓ |
| Stays signed in (90 days, like the site) | ✓ | ✓ (shares Chrome's sign-in) |
| WhatsApp, email and phone links open WhatsApp, the mail app and the dialler | ✓ | ✓ |
| Connect with Facebook (lead ads, WhatsApp signup), Google sign-in | ✓ (in-app window) | ✓ |
| Voice notes (microphone) | ✓ | ✓ |
| Attendance by location | Mac ✓; Windows/Linux only where the computer knows its location | ✓ |
| Selfie for attendance | file picker | camera |
| Downloads (CSV, calendar, files) | straight to Downloads | Chrome's downloads |
| Print, Save as PDF | File menu, Ctrl/Cmd+P | Chrome's share menu |
| Offline | a "You're offline" page that retries by itself | Chrome's offline page |
| studioautopilot.in links open in the app | `studioautopilot://open/leads` | ✓ (any studioautopilot.in link) |

Desktop shortcuts: **Ctrl/Cmd+1** Leads, **+2** Projects, **+3** Shoots, **+4**
Post-Production, **+5** Tasks, **+6** Money. The mouse's back and forward buttons
work too.

## Android signing (keep the key safe)

Android lets an update replace an installed app only when both are signed with the
**same key**. Chrome hides the address bar only when
`https://studioautopilot.in/.well-known/assetlinks.json` names that key
(`apps/web/public/.well-known/assetlinks.json`, fingerprint `02:DD:FA:7C:…:82:67`).

- The release key is `studio-autopilot-release.p12`, alias `studioautopilot`. It is
  **never** committed. The owner keeps the file and its password in a safe place.
- For CI to sign with it, add two repository secrets (**Settings → Secrets and
  variables → Actions**):
  - `ANDROID_KEYSTORE_B64`: the output of `base64 -w0 studio-autopilot-release.p12`
    (on a Mac, `base64 -i studio-autopilot-release.p12`).
  - `ANDROID_KEYSTORE_PASSWORD`: its password.
- Without those secrets, CI signs with a throwaway key and names the file
  `…-test-key.apk`. Use that file only for testing.
- If the key is ever lost, make a new one. Add its SHA-256 fingerprint to
  `assetlinks.json` beside the old one (`keytool -list -v -keystore new.p12`).
  Everyone then uninstalls the old app once and installs the new one.

To build the APK on a computer that has the Android SDK:

```bash
ANDROID_HOME=~/Android/Sdk ANDROID_KEYSTORE=studio-autopilot-release.p12 \
  ANDROID_KEYSTORE_PASSWORD='…' bash native/android/build.sh
```

## Checking a new build

**Desktop:** do each of these once.
1. Sign in.
2. Open a project's quotation and use **Send to client ▾ → WhatsApp**. WhatsApp
   should open, and no empty window should be left behind.
3. **Settings → Lead sources → Connect with Facebook** should open Facebook inside
   the app, then come back.
4. **Team → Pay → Team payouts → CSV** should leave the file in Downloads.
5. Record a voice note on a deliverable.
6. **File → Save page as PDF** on an invoice.
7. Turn Wi-Fi off and on: the "You're offline" page should come back by itself.

**Android:**
1. Open the app. There should be no address bar.
2. Repeat steps 1, 2 and 5 from the desktop list.
3. With attendance switched on, **Check in** on Home should ask for location.
4. Tap a studioautopilot.in link in WhatsApp. It should open in the app.

If an address bar shows at the top, the phone could not match the app to the
site. Check that `assetlinks.json` is live
(`curl -i https://studioautopilot.in/.well-known/assetlinks.json` returns JSON,
not the app's HTML), and that the APK was signed with the release key.
