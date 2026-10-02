# Rhymes Highlighter

Search for a song, read its lyrics, and see rhyming words highlighted — every
word is coloured by the rhyme family it belongs to. Select a family to step
through where it occurs in the song.

- **Song catalogue** — [Genius](https://genius.com) (search, song metadata)
- **Lyric text** — [lyrics.ovh](https://lyricsovh.docs.apiary.io), with a paste-your-own fallback so highlighting always works
- **Rhyme data** — [Datamuse](https://api.datamuse.com/api/)

## Quick start

```bash
npm install
cp .env.example .env   # add your GENIUS_ACCESS_TOKEN (optional but recommended)
npm start              # Express API on http://localhost:3001
npm run dev            # in another terminal: Vite on http://localhost:5173 (proxies /api)
```

Open http://localhost:5173. Get a Genius access token by creating an API client
at [genius.com/api-clients](https://genius.com/api-clients) — keep it in the
server-side `.env`, never in the frontend bundle. Without a token the app still
runs: search shows a "catalogue unavailable" state and you can paste lyrics
directly.

## API

| Route | Responsibility |
|---|---|
| `GET /api/search?q=…` | Song results and artist suggestions from Genius |
| `GET /api/songs/:id` | Song metadata |
| `GET /api/songs/:id/lyrics` | Lyric text and provenance, or an explicit unavailable/error status |
| `POST /api/highlight` | Analyse text: tokens with offsets + rhyme families (`{ text: "..." }`) |
| `GET /api/health` | Server status and catalogue availability |

Errors are JSON: `{ "error": { "code": "...", "message": "..." } }` with a
meaningful HTTP status.

## How highlighting works

The backend tokenises the text, looks up rhymes for each unique word at
Datamuse (cached, bounded concurrency), and clusters words greedily: a word
joins the first cluster whose seed word it rhymes with. Clusters with a rhyme
partner become **families** with stable ids. The frontend renders the original
text verbatim (spacing, punctuation, casing, line breaks) and paints only the
word spans, assigning each family a deterministic colour from a fixed palette.

## Deployment

Vercel: the Express app in `api/index.js` runs as a serverless function;
`vercel.json` builds the frontend (`dist/`), routes `/api/*` to the function
and serves the SPA for everything else. Set `GENIUS_ACCESS_TOKEN` in the
project's environment variables.
