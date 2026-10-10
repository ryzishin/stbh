# STEM Tesla BioHub

> The study hub for the Tesla STEM Biology 2 class at Dangcagan National High School.
>
> _Explore. Practice. Apply. Discover Biology._

BioHub brings together everything the Biology 2 class needs in one place — organized notes, practice quizzes with randomized retries, flashcards, and live tests hosted by the teacher. Built as a mobile-first, installable PWA.

Built with **Express + EJS + MongoDB + Socket.IO**.

---

## Features

- **Notes library** — units and parts built from a block editor (paragraphs, headings, lists, images, dividers, callouts).
- **Practice quizzes** — unlimited retries, randomized items and options, instant scoring with explanations.
- **Flashcards** — flip-card review with per-card scoring and per-unit filtering.
- **Live tests** — the teacher hosts a quiz and the class answers in real time, with auto-fullscreen, progress persistence across refreshes, and auto-submit at the warning cap (no auto-kick).
- **Streaks & leaderboard** — daily streaks and a weekly leaderboard that resets every Monday.
- **Reactions** — like/dislike on notes units, quiz results, and flashcard decks.
- **Admin dashboard** — promote students to sub-admin, view roster, host live tests, monitor real-time activity, and review official scores with timestamps from the dedicated Scores & History panel.
- **PWA installable** — add BioHub to a phone or laptop home screen.

---

## Tech stack

| Layer        | Choice                                   |
|--------------|-------------------------------------------|
| Server       | Node.js + Express                         |
| Views        | EJS + express-ejs-layouts                 |
| Database     | MongoDB (Atlas in production, in-memory MongoDB in dev) |
| Real-time    | Socket.IO                                 |
| Auth         | Session + bcrypt (UID/LRN or username)   |
| Uploads      | MongoDB BSON (no disk)                    |
| PWA          | Web manifest + service worker            |

---

## Getting started

### Prerequisites

- Node.js 18 or newer
- A MongoDB instance (Atlas free tier is fine) — or omit `MONGODB_URI` to use the in-memory MongoDB for local dev

### Install

```bash
git clone <repo-url> stbh
cd stbh
npm install
cp .env.example .env
# fill in real values (see below)
npm run dev
```

The app boots at <http://localhost:3000>.

### Environment variables

| Variable           | Required | Description                                                            |
|--------------------|----------|------------------------------------------------------------------------|
| `NODE_ENV`         | no       | `development` (default) or `production`.                               |
| `PORT`             | no       | HTTP port (default 3000).                                              |
| `SESSION_SECRET`   | **yes** | Long random string for cookie signing.                                 |
| `MONGODB_URI`      | no       | MongoDB connection string. When unset, an in-memory MongoDB is used.   |
| `MONGODB_DB_NAME`   | no       | Database name (default `stbh`).                                        |
| `ADMIN_UID`        | no       | Bootstrap admin UID. Auto-created on first boot if no admin exists.    |
| `ADMIN_PASSWORD`   | no       | Bootstrap admin password.                                              |
| `ADMIN_NAME`       | no       | Bootstrap admin display name (default "Adviser").                     |
| `ADMIN_USERNAME`   | no       | Bootstrap admin username (default "adviser").                         |
| `PUBLIC_URL`       | no       | Deployed origin (used for absolute links).                             |

When `MONGODB_URI` is omitted, the app spins up `mongodb-memory-server` — data is lost on restart. Always set `MONGODB_URI` for production.

---

## Account management scripts

```bash
# Bulk-create accounts from a CSV
npm run accounts:create -- path/to/accounts.csv

# Reset a user's password (prints the new temp password)
npm run accounts:reset -- <uid>

# Promote / demote a user
npm run accounts:promote -- <uid> <role>   # role: student | subadmin | admin

# Re-create indexes (idempotent)
npm run db:indexes
```

CSV format (one account per line, header optional):

```
uid,user,name,role
123456789012,althea,Althea Reyes,student
ms.roa,ms.roa,Ms. Patricia Roa,admin
```

A 3-column `uid,name,role` format also works; the username is auto-derived from the name.

---

## Roles

| Role       | Capabilities                                                                                |
|------------|----------------------------------------------------------------------------------------------|
| `student`  | Read notes, take practice quizzes, review flashcards, join live tests, react to content.    |
| `subadmin` | Everything a student can do, plus edit notes, practice quizzes, and flashcards.             |
| `admin`    | Everything a sub-admin can do, plus host live tests, monitor activity, manage scores and history, promote/demote users, and change settings. |

The first admin is auto-created on boot if `ADMIN_UID` + `ADMIN_PASSWORD` are set and the database has no admin. Students can be promoted to sub-admin (or demoted) from the admin dashboard.

---

## Project structure

```
stbh/
├── public/                 # Static assets (CSS, JS, icons, manifest, service worker)
│   ├── css/style.css       # Global theme — STEM-logo-matched palette
│   ├── js/                 # Client JS (toast, app, profile, editors)
│   ├── icons/              # PWA icons
│   ├── assets/             # STEM logo and other images
│   ├── manifest.json       # PWA manifest
│   └── sw.js                # Service worker
├── scripts/                # CLI utilities (accounts, seed, cipher, indexes)
├── src/
│   ├── config/             # env, mongo, cipher
│   ├── controllers/        # Express route handlers (auth, notes, quizzes, admin, reactions, etc.)
│   ├── middleware/         # auth, shareLocals
│   ├── routes/             # Route table
│   ├── services/           # Business logic (notes, quizzes, flashcards, realtime, reactions, settings, etc.)
│   ├── views/              # EJS templates (layouts, partials, pages)
│   └── server.js           # Express app entry point
└── package.json
```

---

## Live test behavior

- The teacher starts a session from `/admin/host-live` and advances items one at a time.
- Students join from `/live-test`; the page auto-fullscreens on join (when fullscreen is required).
- The student's in-progress answers are persisted to both `localStorage` and a server-side draft, so a refresh restores the exact state without retaking.
- Once an item is submitted, it cannot be re-submitted — even after a refresh.
- At the anti-cheat warning cap, the student's current answer is auto-submitted (the student stays in the test for the next item).
- The teacher's **Scores & History** panel shows the active session's score table in real time, plus a full history of past sessions with submission timestamps.

---

## Deployment (Render)

1. Create a new Web Service from this repo.
2. Set `MONGODB_URI` to your Atlas connection string (percent-encode special chars in the password).
3. Set `SESSION_SECRET`, `ADMIN_UID`, `ADMIN_PASSWORD`, and `PUBLIC_URL`.
4. Build command: `npm install`
5. Start command: `npm start`
6. Render assigns `PORT` automatically — the app reads it from the env.

---

## License

MIT.
