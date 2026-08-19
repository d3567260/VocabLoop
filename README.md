# VocabLoop

A small full-stack **spaced-repetition vocabulary trainer**. Import a TOEIC
deck (or add words yourself), then review them as flashcards — VocabLoop
schedules each card using an SM-2 style algorithm so you see hard words more
often and easy words less often.

The default import is aimed at a **~350 TOEIC score**: `0-400` score band and
5★ high-frequency words from
[`kknono668/toeic-vocab-tw`](https://huggingface.co/datasets/kknono668/toeic-vocab-tw)
(CC BY-SA 4.0). New cards are capped at **15 per day** so a 1,000-word beginner
deck is not all due on day one.

## Stack

| Layer    | Tech                                            |
| -------- | ----------------------------------------------- |
| Frontend | React 18 + TypeScript + Vite                    |
| Backend  | Node.js + Express                               |
| Storage  | SQLite (via `better-sqlite3`)                   |
| Scheduling | SM-2 style spaced-repetition (`server/src/srs.js`) |

The project is an npm-workspaces monorepo:

```
vocabloop/
├── client/   # Vite + React frontend
├── server/   # Express + SQLite API
└── package.json  # workspace root
```

## Getting started

Requires Node.js 20+.

```bash
npm install          # installs both workspaces
npm run dev:server   # API on http://localhost:3001
npm run dev:client   # web on http://localhost:5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` requests to the
Express backend, so you only need to visit the web URL. Click **匯入 350 分入門卡組**
(or tighten the score / star / category filters), then switch to **複習** to study.
The first import downloads the Hugging Face catalog and caches it under
`server/data/toeic_vocabulary.json`.

## Scripts

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `npm install`        | Install all workspace dependencies      |
| `npm run dev:server` | Start the API with live reload          |
| `npm run dev:client` | Start the Vite dev server               |
| `npm run build`      | Type-check and build the frontend       |
| `npm test`           | Run the backend unit tests              |

## API

| Method | Path                | Description                          |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/api/health`       | Health check                         |
| GET    | `/api/stats`        | Deck stats (total / due / learned)   |
| GET    | `/api/words`        | List all words                       |
| POST   | `/api/words`        | Add a word `{term, definition, example?}` |
| DELETE | `/api/words/:id`    | Delete a word                        |
| GET    | `/api/review/next`  | Next due card (or `null`)            |
| POST   | `/api/review/:id`   | Grade a card `{grade}` (again/hard/good/easy) |
| POST   | `/api/seed`         | Load the sample deck (if empty)      |
| GET    | `/api/import/toeic/preview` | Count matching TOEIC entries (`scoreRange`, `minStar`, `category`) |
| POST   | `/api/import/toeic` | Import matching TOEIC cards (skips duplicates) |

## Development environment (Cursor Cloud Agents)

`.cursor/environment.json` provisions this repo for Cursor Cloud Agents:

- `install`: `npm install` (installs both workspaces)
- `terminals`: `api` (backend) and `web` (Vite dev server)
- `ports`: `3001` (api) and `5173` (web)
