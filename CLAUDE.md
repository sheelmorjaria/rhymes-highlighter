# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A "rhymes highlighter" web app: search for a song, fetch its lyrics, and render every word with a background colour so words that rhyme with each other share a colour. Two halves — a React + Vite frontend (`src/`) and an Express backend (`api/index.js`).

The catalogue is **Genius** (song search, song/artist metadata, artist song lists), the lyric text comes from **lyrics.ovh** with **lrclib.net** as a fallback provider (tried per title variant; the response's `provenance` says which one supplied the text), plus a paste-your-own fallback, and rhyme data comes from **Datamuse**. Similar-artist discovery uses **Last.fm** when `LASTFM_API_KEY` is set. This covers "Packages 1–2" of the plan to evolve the app into an artist-exploration app; rhyme-based song comparison (Package 3) is planned but **not built yet**.

## Commands

- `npm run dev` — Vite dev server (port 5173) with a `/api` proxy to `localhost:3001`, so relative API URLs work in local dev.
- `npm start` — Express backend (`api/index.js`, port `process.env.PORT || 3001`). Loads a local `.env` at startup (parsed in-code, so no Node CLI flag is needed).
- `npm run build` / `npm run preview` — build the frontend to `dist/` and preview it.
- `npm run lint` — ESLint over all `.js`/`.jsx` files. Backend files get Node globals; the rest get browser globals.
- There are no tests and no test runner.

For full-stack local work run both `npm start` and `npm run dev`.

## Environment variables (server-side only)

- `GENIUS_ACCESS_TOKEN` — Genius API bearer token. **Without it the app still runs**: search reports a visible "catalogue unavailable" state, and pasting lyrics for highlighting still works. Never expose this to the frontend (no `VITE_` prefix).
- `LASTFM_API_KEY` — optional; enables similar-artist cards on artist pages via Last.fm `artist.getSimilar`. Without it the section reports "not configured" and the artist page keeps working. The `match` score is used for ordering only, never displayed as a "N% similar" claim.
- `DATAMUSE_API_KEY` — optional today; Datamuse has announced keys will be required from 1 Jan 2027.

See `.env.example`.

## How the pieces connect (the end-to-end flow)

All external HTTP goes through the backend; the frontend uses only relative `/api/...` URLs:

1. Search → `App.runSearch()` calls `GET /api/search?q=...` → backend proxies to `api.genius.com/search` with `Authorization: Bearer`. Returns JSON: `{ query, songs, artists }` — songs are `{ id, title, fullTitle, artist, artistNames, artworkUrl, sourceUrl }`; artists are suggestions derived from the song hits (not a full artist search, and the UI labels them as such).
2. Select a song → `App.loadSong(id)` chains three requests, each guarded by a per-song sequence number so stale responses are dropped and a cache (`songsRef`) lets you revisit a song without refetching:
   - `GET /api/songs/:id` → Genius song metadata (`{ song }`).
   - `GET /api/songs/:id/lyrics` → tries lyrics.ovh then lrclib.net, each with the full title then stripped variants (parentheticals, "- Remix" suffixes). Returns `{ songId, status: "available" | "unavailable" | "error", text?, provenance? }` — availability is data, always HTTP 200 here. Failures are distinct from "no lyrics found".
   - `POST /api/highlight` with `{ text }` → rhyme analysis (below). The reader shows the plain text while analysis runs.
3. Rendering → `LyricsReader` (view modes: All rhymes / Selected family / Plain) → `RhymesOutput` builds segments from the **original text plus token offsets**, painting only word spans. `familyColors.js` maps stable family ids to a fixed palette — colours are deterministic, never shuffled.
4. Artist exploration → `ArtistPage` loads `GET /api/artists/:id` (header), `GET /api/artists/:id/songs?page=N` (paginated, "More songs" button) and `GET /api/artists/:id/similar` (Last.fm, optional). Similar-artist and artist-suggestion clicks resolve a *name* back into the Genius catalogue via `GET /api/artists/lookup?name=…`; if resolution fails it falls back to a plain search. A song opened from an artist page keeps its artist context (`?artist=`): the sidebar shows that artist's other songs (`ArtistContext`) instead of search results.

App state is URL-synced (`?q=`, `?song=`, `?artist=`) via `history.pushState`/`popstate`, so searches, open songs and artist pages survive refresh and browser navigation; there is an in-app Back button alongside browser back. The exploration trail ("Recently opened", capped at 8, with artist context) persists in `localStorage` under `rhymes.recent`.

If lyrics are unavailable (or the provider errors), the reader offers a paste box; pasted text flows through the same `POST /api/highlight` analysis. The home page has the same paste box as a first-class entry point.

## The rhyme analyser (`api/index.js`)

- Tokenisation: `/[A-Za-zÀ-ÖØ-öø-ÿ''']+/g` over the raw text. Each token carries `{ text, start, end, word }` — `word` is the normalised form (lowercase, curly apostrophes straightened, outer apostrophes stripped); `text`/offsets preserve the original casing and position. The same normalisation contract is used everywhere; the frontend never re-normalises.
- Datamuse (`api.datamuse.com/words?rel_rhy=WORD`) is the source of truth for "what rhymes". Lookups run with bounded concurrency (8), are cached in a module-level `Map`, and a **failed lookup is stored as `null` — distinct from "no rhymes"**.
- `rhymesWith(a, b)` is false when `a === b`: repeated words are repetition, not rhyme, so "the … the" never forms a family.
- Clustering is **greedy first-match**: each word joins the first cluster whose seed word it rhymes with, else seeds a new cluster. Order-dependent and not transitive — a word is grouped with the *first* matching seed. Clusters with fewer than two members are dropped. **Revisit this before deriving artist-level statistics** (Package 3 of the plan).
- Families get stable ids `family-1, family-2, …` in creation order, plus letter labels and up to three example words. Response: `{ analysisVersion, status, families, tokens, stats }` where status is `ready | partial | failed | empty` (`partial` = some Datamuse lookups failed; `failed` = all did; `empty` = no words). Analyses are cached by `sha1(text)` + analysis version.
- Frontend `familyColors.js` assigns palette colours by family order — deterministic per text. There is no `generateRhymes` anywhere anymore (the old frontend/backend name collision is gone); backend `analyseText` analyses, frontend only colours.

## Deployment (Vercel)

`api/index.js` does `export default app` (Vercel serves it as a serverless function) and only calls `app.listen` when `process.env.VERCEL` is unset. `vercel.json` builds the frontend to `dist/`, routes `/api/(.*)` to the function, and falls everything else back to `/index.html` for the SPA. Set `GENIUS_ACCESS_TOKEN` in the Vercel project env vars.
