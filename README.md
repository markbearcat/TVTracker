# TiVo Tracker 📺

A vintage TiVo-inspired Progressive Web App (PWA) for tracking your TV shows, syncing with Stremio, and auto-adding upcoming episodes to Google Calendar.

## Features

- 🔍 **Search & Track** — Search TMDB for any TV show and add to your personal list
- ⭐ **Stremio Watchlist** — Add shows directly to your Stremio library (stays logged in)
- 📅 **Google Calendar Sync** — Upcoming episodes auto-added as calendar events
- 🔄 **Smart Sync** — Detects missing calendar entries and recreates them; flags duplicates
- 💾 **Local Storage** — All data stored on-device; no account needed
- 📦 **Backup & Restore** — Export/import your show list as JSON
- 🎨 **TiVo Aesthetic** — Vintage CRT-inspired UI, monochromatic with amber highlights
- 🌓 **Light/Dark/Auto** — Follows system theme or set manually
- 📱 **Install on Android** — Full PWA, installable from Chrome/Edge

---

## Quick Start (GitHub Pages)

1. **Fork** this repository
2. Go to **Settings → Pages** → Source: `main` branch, root `/`
3. Your app will be live at `https://yourusername.github.io/tivo-tracker/`
4. Visit on Android Chrome → tap **⋮ menu → Add to Home Screen**

---

## Setup Instructions

### 1. TMDB API (TV Data)
The app uses a public TMDB API key by default. For production, get your own free key at [themoviedb.org](https://www.themoviedb.org/settings/api) and replace `API_KEY` in `js/api.js`.

### 2. Stremio
- Open Settings in the app
- Enter your Stremio email and password
- Tap **Connect to Stremio**
- Credentials are stored only on your device

### 3. Google Calendar (required for calendar sync)

You need to create a Google OAuth 2.0 Client ID:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable **Google Calendar API**: APIs & Services → Library → search "Google Calendar API" → Enable
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add your GitHub Pages URL to **Authorized JavaScript origins** (e.g., `https://yourusername.github.io`)
7. Copy the **Client ID**
8. Open the app → Settings → Google Calendar → paste your Client ID → Connect

> **Note:** Your Client ID is stored only on your device. The app never sends it anywhere.

---

## How Sync Works

- **On first connect**, the app fetches upcoming episodes for all your shows and creates Google Calendar events
- **On each sync**, it:
  1. Checks all tracked episodes against your Google Calendar
  2. **Recreates any missing events** (if you accidentally deleted them, they come back)
  3. **Updates changed events** (if episode title or date changed)
  4. **Flags duplicates** and asks what you'd like to do (keep both / replace / skip)
- Auto-sync runs on a schedule (configurable: hourly, 6h, daily, or manual)

---

## File Structure

```
tivo-tracker/
├── index.html          # App shell
├── manifest.json       # PWA manifest (Android install)
├── sw.js               # Service Worker (offline support)
├── css/
│   └── style.css       # Vintage TiVo theme
├── js/
│   ├── storage.js      # Local storage manager
│   ├── api.js          # TMDB TV data API
│   ├── stremio.js      # Stremio integration
│   ├── gcal.js         # Google Calendar integration
│   ├── ui.js           # UI rendering
│   └── app.js          # Main controller
└── icons/
    ├── icon-192.png    # App icon
    └── icon-512.png    # App icon (large)
```

---

## Backup & Restore

- **Export**: Settings → Data & Backup → Export Backup (saves `.json` file)
- **Import**: Settings → Data & Backup → Import Backup (restores shows and calendar event IDs)
- Credentials (Stremio, Google Client ID) are **not** included in backups for security

---

## Privacy

- All data is stored **locally on your device** using `localStorage`
- No server, no account, no tracking
- Google Calendar access uses OAuth — your Google password is never seen by the app
- Stremio password is stored locally in encrypted form via `localStorage`

---

## Android Installation

1. Open the app URL in **Chrome for Android**
2. A banner will appear: "Install TiVo Tracker as an app" — tap **Install**
3. Or: tap **⋮ (three dots) → Add to Home screen**
4. The app installs like a native app with its own icon

---

## License

MIT — free to use, modify, and deploy.
