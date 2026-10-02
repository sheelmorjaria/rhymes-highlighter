import express from "express";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "256kb" }));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const UPSTREAM_TIMEOUT_MS = 10000;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function fetchJson(url, { headers, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const cause = error?.name === "TimeoutError" ? "timed out" : "was unreachable";
    throw new ApiError(504, "upstream_unreachable", `${new URL(url).host} ${cause}`);
  }
  if (!response.ok) {
    const error = new ApiError(
      502,
      "upstream_error",
      `${new URL(url).host} responded with status ${response.status}`
    );
    error.upstreamStatus = response.status;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError(502, "upstream_error", `${new URL(url).host} returned invalid JSON`);
  }
}

function sendApiError(res, error) {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  console.error("Unexpected error:", error);
  res.status(500).json({ error: { code: "internal_error", message: "Unexpected server error" } });
}

// Run `worker` over `items` with at most `limit` calls in flight.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// ---------------------------------------------------------------------------
// Catalogue provider: Genius
// ---------------------------------------------------------------------------

const GENIUS_BASE_URL = "https://api.genius.com";
const SONG_CACHE_TTL_MS = 60 * 60 * 1000;
const songCache = new Map(); // songId -> { song, fetchedAt }

function geniusToken() {
  return process.env.GENIUS_ACCESS_TOKEN || "";
}

async function geniusRequest(path, params = {}) {
  const token = geniusToken();
  if (!token) {
    throw new ApiError(
      503,
      "catalogue_unavailable",
      "No Genius access token is configured on the server (set GENIUS_ACCESS_TOKEN)"
    );
  }
  const url = new URL(path, GENIUS_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
}

function normalizeArtist(artist) {
  return {
    id: artist.id,
    name: artist.name,
    imageUrl: artist.image_url || null,
    sourceUrl: artist.url || null,
  };
}

function normalizeSong(result) {
  const artist = result.primary_artist ? normalizeArtist(result.primary_artist) : null;
  return {
    id: result.id,
    title: result.title || "",
    fullTitle: result.full_title || result.title || "",
    artist,
    artistNames: result.artist_names || artist?.name || "",
    artworkUrl: result.song_art_image_url || result.header_image_thumbnail_url || null,
    sourceUrl: result.url || null,
  };
}

async function getGeniusSong(songId) {
  const cached = songCache.get(songId);
  if (cached && Date.now() - cached.fetchedAt < SONG_CACHE_TTL_MS) {
    return cached.song;
  }
  let data;
  try {
    data = await geniusRequest(`/songs/${songId}`);
  } catch (error) {
    if (error.upstreamStatus === 404) {
      throw new ApiError(404, "song_not_found", `Genius has no song with id ${songId}`);
    }
    throw error;
  }
  const song = data?.response?.song;
  if (!song?.id) {
    throw new ApiError(502, "upstream_error", "Genius returned an unexpected song payload");
  }
  const normalized = normalizeSong(song);
  songCache.set(songId, { song: normalized, fetchedAt: Date.now() });
  return normalized;
}

// ---------------------------------------------------------------------------
// Lyrics provider: lyrics.ovh
// ---------------------------------------------------------------------------

const LYRICS_OVH_BASE = "https://api.lyrics.ovh/v1";
const LYRICS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const lyricsCache = new Map(); // "artist|title" -> { result, fetchedAt }

function normalizeLyricText(text) {
  return text.replace(/\r\n?/g, "\n").trim();
}

// Genius titles often carry version decoration that lyrics.ovh does not know:
// "Calm Down (with Selena Gomez)" or "Bohemian Rhapsody - Remastered 2011".
function lyricTitleCandidates(title) {
  const attempts = [title];
  const withoutParenthetical = title.replace(/\s*[[(][^\])]*[\])]\s*$/u, "").trim();
  const withoutSuffix = withoutParenthetical.replace(/\s+[-–—]\s+.+$/u, "").trim();
  for (const candidate of [withoutParenthetical, withoutSuffix]) {
    if (candidate && !attempts.includes(candidate)) {
      attempts.push(candidate);
    }
  }
  return attempts;
}

async function fetchLyricsFromProvider(artistName, title) {
  for (const candidate of lyricTitleCandidates(title)) {
    const url = `${LYRICS_OVH_BASE}/${encodeURIComponent(artistName)}/${encodeURIComponent(candidate)}`;
    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      const cause = error?.name === "TimeoutError" ? "timed out" : "was unreachable";
      return { status: "error", message: `The lyrics provider ${cause}.` };
    }
    if (response.ok) {
      const data = await response.json().catch(() => null);
      const text = typeof data?.lyrics === "string" ? normalizeLyricText(data.lyrics) : "";
      if (text) {
        return { status: "available", text, provenance: { provider: "lyrics.ovh" } };
      }
      continue; // Empty body: try the next title variant.
    }
    if (response.status === 404) {
      continue;
    }
    return { status: "error", message: `The lyrics provider responded with status ${response.status}.` };
  }
  return { status: "unavailable" };
}

async function getLyrics(song) {
  const artistName = song.artist?.name || song.artistNames;
  if (!artistName || !song.title) {
    return { status: "unavailable" };
  }
  const cacheKey = `${artistName.toLowerCase()}|${song.title.toLowerCase()}`;
  const cached = lyricsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < LYRICS_CACHE_TTL_MS) {
    return cached.result;
  }
  const result = await fetchLyricsFromProvider(artistName, song.title);
  lyricsCache.set(cacheKey, { result, fetchedAt: Date.now() });
  return result;
}

// ---------------------------------------------------------------------------
// Rhyme analyser
// ---------------------------------------------------------------------------

const ANALYSIS_VERSION = "2";
const DATAMUSE_URL = "https://api.datamuse.com/words";
const DATAMUSE_CONCURRENCY = 8;
const DATAMUSE_TIMEOUT_MS = 8000;
const MAX_TEXT_LENGTH = 20000;
const MAX_UNIQUE_WORDS = 600;

const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ''']+/g;
const rhymeCache = new Map(); // word -> Set<string> of rhymes, or null when the lookup failed
const analysisCache = new Map(); // "version:sha1(text)" -> analysis payload

function normalizeWord(raw) {
  return raw
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^'+|'+$/g, "");
}

// Tokens carry [start, end) offsets into the original text so the renderer can
// display the text verbatim (spacing, punctuation, casing, line breaks) and
// paint only the word spans.
function tokenize(text) {
  const tokens = [];
  for (const match of text.matchAll(WORD_RE)) {
    const word = normalizeWord(match[0]);
    if (!word) {
      continue;
    }
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      word,
    });
  }
  return tokens;
}

async function lookupRhymes(word) {
  if (rhymeCache.has(word)) {
    return rhymeCache.get(word);
  }
  let result = null;
  try {
    const url = new URL(DATAMUSE_URL);
    url.searchParams.set("rel_rhy", word);
    // Optional today; Datamuse has announced keys will be required from 2027.
    if (process.env.DATAMUSE_API_KEY) {
      url.searchParams.set("key", process.env.DATAMUSE_API_KEY);
    }
    const response = await fetchJson(url, { timeoutMs: DATAMUSE_TIMEOUT_MS });
    if (Array.isArray(response)) {
      result = new Set(response.map((entry) => String(entry.word).toLowerCase()));
    }
  } catch {
    result = null; // A failed lookup is distinct from "no rhymes".
  }
  rhymeCache.set(word, result);
  return result;
}

function rhymesWith(rhymeSets, a, b) {
  if (a === b) {
    return false; // Repeated words are repetition, not rhyme.
  }
  const setA = rhymeSets.get(a);
  if (setA && setA.has(b)) {
    return true;
  }
  const setB = rhymeSets.get(b);
  return Boolean(setB && setB.has(a));
}

function familyLabel(index) {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

async function analyseText(text) {
  const tokens = tokenize(text);
  const uniqueWords = [...new Set(tokens.map((token) => token.word))];
  const stats = {
    wordCount: tokens.length,
    uniqueWordCount: uniqueWords.length,
    failedLookupCount: 0,
  };
  const base = { analysisVersion: ANALYSIS_VERSION, families: [], tokens: [], stats };

  if (uniqueWords.length === 0) {
    return { ...base, status: "empty" };
  }

  const rhymeSets = new Map();
  await mapLimit(uniqueWords, DATAMUSE_CONCURRENCY, async (word) => {
    rhymeSets.set(word, await lookupRhymes(word));
  });
  stats.failedLookupCount = uniqueWords.filter((word) => rhymeSets.get(word) === null).length;

  if (stats.failedLookupCount === uniqueWords.length) {
    return {
      ...base,
      status: "failed",
      error: "The rhyme service could not be reached, so no rhymes could be identified.",
    };
  }

  // Greedy first-match clustering: each word joins the first cluster whose seed
  // word it rhymes with, otherwise it seeds a new cluster. Order-dependent by
  // design; revisit before deriving artist-level statistics from it.
  const clusters = [];
  for (const [index, token] of tokens.entries()) {
    let placed = false;
    for (const cluster of clusters) {
      if (rhymesWith(rhymeSets, token.word, cluster.seed)) {
        cluster.tokenIndexes.push(index);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ seed: token.word, tokenIndexes: [index] });
    }
  }

  const families = [];
  const familyIdByTokenIndex = new Map();
  const seenWordsByFamily = [];
  for (const cluster of clusters) {
    if (cluster.tokenIndexes.length < 2) {
      continue; // No rhyme partner for this word anywhere in the text.
    }
    const id = `family-${families.length + 1}`;
    const seen = new Set();
    const examples = [];
    for (const tokenIndex of cluster.tokenIndexes) {
      const word = tokens[tokenIndex].word;
      familyIdByTokenIndex.set(tokenIndex, id);
      if (!seen.has(word)) {
        seen.add(word);
        if (examples.length < 3) {
          examples.push(word);
        }
      }
    }
    seenWordsByFamily.push(seen);
    families.push({
      id,
      label: familyLabel(families.length),
      examples,
      count: cluster.tokenIndexes.length,
    });
  }

  return {
    analysisVersion: ANALYSIS_VERSION,
    status: stats.failedLookupCount > 0 ? "partial" : "ready",
    families,
    tokens: tokens.map((token, index) => ({ ...token, familyId: familyIdByTokenIndex.get(index) ?? null })),
    stats,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, catalogue: geniusToken() ? "available" : "unavailable" });
});

app.get("/api/search", async (req, res) => {
  try {
    const query = String(req.query.q ?? "").trim();
    if (!query) {
      throw new ApiError(400, "bad_request", "Missing required query parameter: q");
    }
    if (query.length > 200) {
      throw new ApiError(400, "bad_request", "Search query is too long (max 200 characters)");
    }
    const data = await geniusRequest("/search", { q: query });
    const hits = Array.isArray(data?.response?.hits) ? data.response.hits : [];

    const songs = [];
    const artists = new Map();
    for (const hit of hits) {
      const result = hit?.result;
      if (hit?.type !== "song" || !result?.id) {
        continue;
      }
      songs.push(normalizeSong(result));
      const primaryArtist = result.primary_artist;
      if (primaryArtist?.id != null && !artists.has(primaryArtist.id)) {
        artists.set(primaryArtist.id, normalizeArtist(primaryArtist));
      }
    }

    res.json({
      query,
      songs: songs.slice(0, 10),
      artists: [...artists.values()].slice(0, 6),
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

function requireSongId(req, res) {
  const songId = req.params.id;
  if (!/^\d+$/.test(songId)) {
    sendApiError(res, new ApiError(400, "bad_request", "Song id must be a numeric Genius id"));
    return null;
  }
  return songId;
}

app.get("/api/songs/:id", async (req, res) => {
  try {
    const songId = requireSongId(req, res);
    if (!songId) return;
    const song = await getGeniusSong(songId);
    res.json({ song });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/songs/:id/lyrics", async (req, res) => {
  try {
    const songId = requireSongId(req, res);
    if (!songId) return;
    const song = await getGeniusSong(songId);
    const result = await getLyrics(song);
    res.json({ songId, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/highlight", async (req, res) => {
  try {
    const body = req.body || {};
    const text =
      typeof body.text === "string"
        ? body.text
        : typeof body.lyrics === "string" // legacy field name from the previous API
          ? body.lyrics
          : null;
    if (text === null) {
      throw new ApiError(400, "bad_request", 'Request body must be JSON: { "text": "..." }');
    }
    if (!text.trim()) {
      throw new ApiError(400, "bad_request", '"text" must not be empty');
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new ApiError(
        422,
        "text_too_long",
        `Text is ${text.length} characters; the analyser supports at most ${MAX_TEXT_LENGTH}`
      );
    }

    const cacheKey = `${ANALYSIS_VERSION}:${createHash("sha1").update(text).digest("hex")}`;
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const tokens = tokenize(text);
    const uniqueWordCount = new Set(tokens.map((token) => token.word)).size;
    if (uniqueWordCount > MAX_UNIQUE_WORDS) {
      throw new ApiError(
        422,
        "too_many_unique_words",
        `Text has ${uniqueWordCount} unique words; the analyser supports at most ${MAX_UNIQUE_WORDS}`
      );
    }

    const analysis = await analyseText(text);
    if (analysis.status !== "failed") {
      if (analysisCache.size >= 50) {
        analysisCache.delete(analysisCache.keys().next().value);
      }
      analysisCache.set(cacheKey, analysis);
    }
    res.json(analysis);
  } catch (error) {
    sendApiError(res, error);
  }
});

// Vercel serves this file as a serverless function; locally we listen directly.
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    const catalogue = geniusToken() ? "available" : "UNAVAILABLE (set GENIUS_ACCESS_TOKEN)";
    console.log(`Rhymes Highlighter API listening on http://localhost:${PORT} — Genius catalogue: ${catalogue}`);
  });
}
