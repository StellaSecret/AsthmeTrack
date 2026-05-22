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

Before building, replace the Google OAuth Client ID placeholder in `www/index.html`:

```js
const GOOGLE_CLIENT_ID = '__GOOGLE_CLIENT_ID__';
// → replace with your actual Web client ID from Google Cloud Console
```

Also add your Android client ID to `android/app/src/main/res/values/strings.xml` for the native OAuth flow.

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
