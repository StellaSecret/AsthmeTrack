# AsthmeTrack

A mobile-first asthma tracking app built with Capacitor (Android / iOS) and a single-file vanilla JS/HTML frontend. Records PEF (DEP) blows, SpO₂, Easyhaler doses, and optional comments. Syncs to Google Drive. Exports to PDF or JSON.

## Tech stack

| Layer | Technology |
|---|---|
| UI | Vanilla JS, HTML, CSS (single `www/index.html`) |
| Native shell | Capacitor 5 |
| Storage | `localStorage` + `@capacitor/preferences` (secure token store) |
| Drive sync | Google OAuth 2.0 via `@capacitor-community/google-auth` |
| PDF export | jsPDF (UMD, deferred load) |
| Tests | Playwright |

## Prerequisites

- Node.js ≥ 18
- Android Studio (for Android builds) or Xcode 14+ (for iOS builds)

## Install

```bash
npm install
npx cap sync
```

## Run in browser (dev)

```bash
node server.js        # serves www/ on http://localhost:3000
```

## Build for Android

```bash
npx cap open android  # opens Android Studio — build & run from there
```

## Configuration

The application uses Google OAuth 2.0 to authenticate and sync data with your Google Drive.

1. Create a Google Cloud Project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Obtain a Web Client ID and add it to your configuration (managed via environment variables in CI/CD, or by replacing the placeholder in `www/app/app.js` and `capacitor.config.json` for local builds).
5. Ensure your Android package name (`com.stellasecret.asthmetrack`) and SHA-1/SHA-256 fingerprints (local, build server, and Play Store signing key) are registered in the Google Cloud Console for the Android application.
6. Host a `/.well-known/assetlinks.json` file on your web domain (`https://stellasecret.github.io/.well-known/assetlinks.json`) containing your app's package name and SHA-256 fingerprint to enable Google Sign-In and App Links.

## Run tests

```bash
npx playwright test
```

## Features

- PEF measurement with 3-blow average and zone classification (green / yellow / red)
- SpO₂ pulse oximetry logging
- Easyhaler dose counter
- 14-day trend charts (PEF + SpO₂)
- Google Drive auto-sync (debounced)
- JSON backup export / import
- PDF report export
- Dose reminders with local notifications
- Dark / light theme toggle (persisted)
- French / English language switch (persisted)
- Secure OAuth token storage via `@capacitor/preferences`

## Project structure

```
www/index.html      ← entire app (HTML + CSS + JS)
www/jspdf.umd.min.js
android/            ← Capacitor Android project
ios/                ← Capacitor iOS project
tests/              ← Playwright end-to-end tests
server.js           ← dev HTTP server
capacitor.config.ts
```
