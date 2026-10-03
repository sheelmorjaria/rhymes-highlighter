import express from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dictionary as CMU_DICTIONARY } from "cmu-pronouncing-dictionary";

// Load a local .env (if present) so `npm start` picks up GENIUS_ACCESS_TOKEN
// and friends without requiring node CLI flags. Vercel injects env vars itself.
if (!process.env.VERCEL) {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (existsSync(envPath)) {
    const lineRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(lineRe);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
    }
  }
}

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
    artworkUrl:
      result.song_art_image_url ||
      result.song_art_image_thumbnail_url ||
      result.header_image_thumbnail_url ||
      null,
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
// Artist catalogue (Genius) and discovery (Last.fm)
// ---------------------------------------------------------------------------

const ARTIST_CACHE_TTL_MS = 60 * 60 * 1000;
const artistCache = new Map(); // artistId -> { artist, fetchedAt }
const artistSongsCache = new Map(); // "artistId:page" -> { payload, fetchedAt }
const similarArtistsCache = new Map(); // lowercase name -> { payload, fetchedAt }
const LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/";

async function getGeniusArtist(artistId) {
  const cached = artistCache.get(artistId);
  if (cached && Date.now() - cached.fetchedAt < ARTIST_CACHE_TTL_MS) {
    return cached.artist;
  }
  let data;
  try {
    data = await geniusRequest(`/artists/${artistId}`);
  } catch (error) {
    if (error.upstreamStatus === 404) {
      throw new ApiError(404, "artist_not_found", `Genius has no artist with id ${artistId}`);
    }
    throw error;
  }
  const artist = data?.response?.artist;
  if (!artist?.id) {
    throw new ApiError(502, "upstream_error", "Genius returned an unexpected artist payload");
  }
  const normalized = normalizeArtist(artist);
  artistCache.set(artistId, { artist: normalized, fetchedAt: Date.now() });
  return normalized;
}

// Resolve an artist *name* into the Genius catalogue by scanning song-search
// hits for a matching primary artist. Exact (case-insensitive) name match
// wins; otherwise the top hit's artist is the best available guess.
async function lookupArtistByName(name) {
  const data = await geniusRequest("/search", { q: name });
  const hits = Array.isArray(data?.response?.hits) ? data.response.hits : [];
  const target = name.toLowerCase();
  let fallback = null;
  for (const hit of hits) {
    const primaryArtist = hit?.result?.primary_artist;
    if (!primaryArtist?.id) {
      continue;
    }
    if (primaryArtist.name.toLowerCase() === target) {
      return normalizeArtist(primaryArtist);
    }
    if (!fallback) {
      fallback = primaryArtist;
    }
  }
  if (!fallback) {
    throw new ApiError(404, "artist_not_found", `No artist named “${name}” was found`);
  }
  return normalizeArtist(fallback);
}

// Similar artists via Last.fm's artist.getSimilar. Optional: without
// LASTFM_API_KEY the endpoint reports "unavailable" (HTTP 200) so artist
// pages keep rendering. The `match` score is used only for ordering — it is
// not surfaced as a "N% similar" claim.
async function getSimilarArtists(artistName) {
  const apiKey = process.env.LASTFM_API_KEY || "";
  if (!apiKey) {
    return { status: "unavailable" };
  }
  const cacheKey = artistName.toLowerCase();
  const cached = similarArtistsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < LYRICS_CACHE_TTL_MS) {
    return cached.payload;
  }

  const url = new URL(LASTFM_BASE_URL);
  url.searchParams.set("method", "artist.getSimilar");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "8");

  let data;
  try {
    data = await fetchJson(url, { timeoutMs: 8000 });
  } catch (error) {
    if (error.upstreamStatus === 403 || error.upstreamStatus === 401) {
      return { status: "error", message: "Last.fm rejected the API key — check LASTFM_API_KEY" };
    }
    return { status: "error", message: `Last.fm ${error.message}` };
  }
  if (data?.error) {
    // Last.fm signals failures as HTTP 200 with an error body.
    return { status: "error", message: `Last.fm: ${data.message || `error ${data.error}`}` };
  }
  const similar = Array.isArray(data?.similarartists?.artist) ? data.similarartists.artist : [];
  const artists = similar.map((entry) => ({
    name: entry.name,
    url: entry.url || null,
    imageUrl:
      (Array.isArray(entry.image) &&
        (entry.image.find((image) => image.size === "large")?.["#text"] || null)) ||
      null,
  }));
  const payload = { status: "available", source: "last.fm", artists };
  similarArtistsCache.set(cacheKey, { payload, fetchedAt: Date.now() });
  return payload;
}

// ---------------------------------------------------------------------------
// Lyrics providers: lyrics.ovh first, lrclib.net as fallback
// ---------------------------------------------------------------------------

const LYRICS_OVH_BASE = "https://api.lyrics.ovh/v1";
const LRCLIB_BASE = "https://lrclib.net/api";
const LYRICS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LYRICS_PROVIDER_TIMEOUT_MS = 8000;
const lyricsCache = new Map(); // "artist|title" -> { result, fetchedAt }

// lrclib.net asks API consumers to identify themselves with a User-Agent.
const LYRICS_USER_AGENT =
  "RhymesHighlighter/0.1 (https://github.com/sheelmorjaria/rhymes-highlighter)";

function normalizeLyricText(text) {
  return text.replace(/\r\n?/g, "\n").trim();
}

// Genius titles often carry version decoration that lyrics providers do not
// know: "Calm Down (with Selena Gomez)" or "Bohemian Rhapsody - Remastered 2011".
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

// Each provider attempt resolves to exactly one of:
//   { hit: true, text, provenance } — lyrics found
//   { hit: false, miss: true }      — provider says it has no such song (404)
//   { hit: false, miss: false, error } — provider unreachable or erroring

async function tryLyricsOvh(artistName, title) {
  const url = `${LYRICS_OVH_BASE}/${encodeURIComponent(artistName)}/${encodeURIComponent(title)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LYRICS_PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = error?.name === "TimeoutError" ? "timed out" : "was unreachable";
    return { hit: false, miss: false, error: `lyrics.ovh ${cause}` };
  }
  if (response.status === 404) {
    return { hit: false, miss: true };
  }
  if (!response.ok) {
    return { hit: false, miss: false, error: `lyrics.ovh responded with status ${response.status}` };
  }
  const data = await response.json().catch(() => null);
  const text = typeof data?.lyrics === "string" ? normalizeLyricText(data.lyrics) : "";
  if (!text) {
    return { hit: false, miss: true }; // Empty body counts as a miss.
  }
  return { hit: true, text, provenance: { provider: "lyrics.ovh" } };
}

// Loose artist-name comparison so provider fuzzy matches can be checked:
// equal, or one name contained in the other (feat./punctuation differences).
function artistNamesCompatible(requested, returned) {
  const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const a = normalize(requested);
  const b = normalize(returned);
  if (!a || !b) {
    return false;
  }
  return a === b || a.includes(b) || b.includes(a);
}

async function tryLrclib(artistName, title) {
  const url = new URL(`${LRCLIB_BASE}/get`);
  url.searchParams.set("artist_name", artistName);
  url.searchParams.set("track_name", title);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": LYRICS_USER_AGENT },
      signal: AbortSignal.timeout(LYRICS_PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = error?.name === "TimeoutError" ? "timed out" : "was unreachable";
    return { hit: false, miss: false, error: `lrclib.net ${cause}` };
  }
  if (response.status === 404) {
    return { hit: false, miss: true };
  }
  if (!response.ok) {
    return { hit: false, miss: false, error: `lrclib.net responded with status ${response.status}` };
  }
  const data = await response.json().catch(() => null);
  // A wrong-artist fuzzy match is a miss, not a hit. (Wrong *versions* with
  // matching names can still slip through — mislabeled upstream data — which
  // is why the reader offers a paste-your-own override on provider lyrics.)
  if (!data?.artistName || !artistNamesCompatible(artistName, data.artistName)) {
    return { hit: false, miss: true };
  }
  const text = typeof data?.plainLyrics === "string" ? normalizeLyricText(data.plainLyrics) : "";
  if (!text) {
    return { hit: false, miss: true }; // Synced-only entry with no plain lyrics.
  }
  return { hit: true, text, provenance: { provider: "lrclib.net" } };
}

const LYRICS_PROVIDERS = [tryLyricsOvh, tryLrclib];

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

  const candidates = lyricTitleCandidates(song.title);
  const errors = [];
  for (const provider of LYRICS_PROVIDERS) {
    for (const candidate of candidates) {
      const attempt = await provider(artistName, candidate);
      if (attempt.hit) {
        const result = {
          status: "available",
          text: attempt.text,
          provenance: attempt.provenance,
        };
        lyricsCache.set(cacheKey, { result, fetchedAt: Date.now() });
        return result;
      }
      if (!attempt.miss) {
        // Provider is down: skip its remaining candidates, try the next provider.
        errors.push(attempt.error);
        break;
      }
      // Clean miss on this candidate: try the next title variant.
    }
  }

  // No provider had the lyrics. If a provider also could not be queried, say
  // so instead of claiming the song simply has no lyrics available.
  const result =
    errors.length > 0
      ? { status: "error", message: [...new Set(errors)].join("; ") }
      : { status: "unavailable" };
  lyricsCache.set(cacheKey, { result, fetchedAt: Date.now() });
  return result;
}

// ---------------------------------------------------------------------------
// Rhyme analyser
// ---------------------------------------------------------------------------

const ANALYSIS_VERSION = "5";
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

async function datamuseRequest(param, word) {
  const url = new URL(DATAMUSE_URL);
  url.searchParams.set(param, word);
  // Optional today; Datamuse has announced keys will be required from 2027.
  if (process.env.DATAMUSE_API_KEY) {
    url.searchParams.set("key", process.env.DATAMUSE_API_KEY);
  }
  const response = await fetchJson(url, { timeoutMs: DATAMUSE_TIMEOUT_MS });
  return Array.isArray(response) ? response.map((entry) => String(entry.word).toLowerCase()) : [];
}

// Rhymes for a word: Datamuse perfect rhymes (rel_rhy) + near rhymes (rel_nry),
// and — for clipped spellings like "hustlin" that Datamuse doesn't know — the
// same lookups for the +g form ("hustling"). Resolves to null only when every
// request failed, keeping "lookup failed" distinct from "no rhymes".
const CLIPPED_IN_RE = /in$/;
async function lookupRhymes(word) {
  if (rhymeCache.has(word)) {
    return rhymeCache.get(word);
  }
  const queries = [
    ["rel_rhy", word],
    ["rel_nry", word],
  ];
  if (CLIPPED_IN_RE.test(word) && word.length >= 5) {
    queries.push(["rel_rhy", `${word}g`], ["rel_nry", `${word}g`]);
  }
  const responses = await Promise.all(
    queries.map(([param, lookupWord]) => datamuseRequest(param, lookupWord).catch(() => null))
  );
  const successes = responses.filter(Array.isArray);
  const result = successes.length > 0 ? new Set(successes.flat()) : null;
  rhymeCache.set(word, result);
  return result;
}

// ---------------------------------------------------------------------------
// Final-syllable sound matching (rap-style slant rhymes) via CMUdict.
// Datamuse has no relation between "metropolis" and "this"; their final
// syllables share the same rime once stress and the ah/ih reduction are
// ignored, which is exactly the loose matching lyric writing uses.
// ---------------------------------------------------------------------------

const CMU_VOWEL_RE = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)([0-2])?$/;
let rimeIndexCache = null; // Map lowercase word -> rime key (built lazily)

function buildRimeIndex() {
  const index = new Map();
  for (const [entry, pronunciation] of Object.entries(CMU_DICTIONARY)) {
    const word = entry.toLowerCase();
    if (index.has(word)) {
      continue; // First pronunciation wins; alternates ("READ(1)") are skipped.
    }
    const phones = pronunciation.split(" ");
    let lastVowel = -1;
    for (let i = 0; i < phones.length; i++) {
      if (CMU_VOWEL_RE.test(phones[i])) {
        lastVowel = i;
      }
    }
    if (lastVowel === -1) {
      continue;
    }
    // Rime = final vowel onward. Stress digits are dropped; AH and IH merge
    // (unstressed reduction makes them near-identical in sung/rap delivery).
    const parts = [];
    for (let i = lastVowel; i < phones.length; i++) {
      const match = phones[i].match(/^([A-Z]+?)([0-2])?$/);
      if (!match) {
        parts.length = 0;
        break;
      }
      parts.push(i === lastVowel && (match[1] === "AH" || match[1] === "IH") ? "X" : match[1]);
    }
    if (parts.length > 0) {
      index.set(word, parts.join(" "));
    }
  }
  rimeIndexCache = index;
  return index;
}

function getRimeIndex() {
  return rimeIndexCache ?? buildRimeIndex();
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

// Union-find over unique words, used to build rhyme families as connected
// components. Three edge sources, all loose in the way lyric writing is:
//   1. Datamuse: one word appears in the other's perfect/near rhyme list.
//   2. Clipped-form aliases: "hustlin" matches rhymes of "hustling".
//   3. CMUdict final-syllable rime sharing, stress-insensitive.
// A family is a component with at least two distinct words. This is
// order-independent and deterministic.
function buildWordFamilies(uniqueWords, rhymeSets, firstIndexOfWord, aliasOwners) {
  const parent = new Map(uniqueWords.map((word) => [word, word]));
  const find = (word) => {
    let root = word;
    while (parent.get(root) !== root) {
      root = parent.get(root);
    }
    let current = word;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  };

  const present = new Set(uniqueWords);
  for (const alias of aliasOwners.keys()) {
    present.add(alias);
  }
  for (const word of uniqueWords) {
    const rhymes = rhymeSets.get(word);
    if (!rhymes) {
      continue; // Failed lookup: this word gets no Datamuse edges.
    }
    for (const candidate of rhymes) {
      if (candidate === word) {
        continue;
      }
      if (present.has(candidate)) {
        union(word, candidate);
      } else {
        const owner = aliasOwners.get(candidate);
        if (owner && owner !== word) {
          union(word, owner); // e.g. "bustling" in a rhyme list -> "bustlin"
        }
      }
    }
  }

  const rimeIndex = getRimeIndex();
  const wordsByRime = new Map();
  for (const word of uniqueWords) {
    // Clipped words ("livin") aren't in CMUdict; match via their +g form.
    const clipped = CLIPPED_IN_RE.test(word) && word.length >= 5;
    const key = rimeIndex.get(word) ?? (clipped ? rimeIndex.get(`${word}g`) : undefined);
    if (!key) {
      continue;
    }
    const list = wordsByRime.get(key);
    if (list) {
      list.push(word);
    } else {
      wordsByRime.set(key, [word]);
    }
  }
  for (const words of wordsByRime.values()) {
    for (let i = 1; i < words.length; i++) {
      union(words[0], words[i]);
    }
  }

  const wordsByRoot = new Map();
  for (const word of uniqueWords) {
    const root = find(word);
    const list = wordsByRoot.get(root);
    if (list) {
      list.push(word);
    } else {
      wordsByRoot.set(root, [word]);
    }
  }

  // Order families by first appearance in the text so ids and colours are stable.
  const groups = [...wordsByRoot.values()]
    .filter((words) => words.length >= 2)
    .map((words) => words.slice().sort((a, b) => firstIndexOfWord.get(a) - firstIndexOfWord.get(b)))
    .sort(
      (a, b) => firstIndexOfWord.get(a[0]) - firstIndexOfWord.get(b[0])
    );

  const families = groups.map((words, index) => ({
    id: `family-${index + 1}`,
    label: familyLabel(index),
    words,
    examples: words.slice(0, 3),
  }));
  return families;
}

// Stanzas (verses, choruses, bridges…) as blank-line-separated blocks of the
// original text. Returns char ranges; token membership is derived by offset.
function stanzaRanges(text) {
  const ranges = [];
  const blankLine = /\n[ \t\r]*(?:\n[ \t\r]*)+/g;
  let cursor = 0;
  let match;
  while ((match = blankLine.exec(text)) !== null) {
    ranges.push([cursor, match.index]);
    cursor = match.index + match[0].length;
  }
  ranges.push([cursor, text.length]);
  return ranges.filter(([start, end]) => text.slice(start, end).trim().length > 0);
}

// Writing-pattern measurements. Lines come from "\n" positions relative to
// token offsets; a token is line-ending when the next token starts a new line.
// measure(from, to) computes the rhyme measurements over a token range, so the
// whole song and each stanza are measured with exactly the same definitions.
function computeMetrics(text, tokens) {
  const wordCount = tokens.length;
  const uniqueWordCount = new Set(tokens.map((token) => token.word)).size;

  const tokenLines = new Array(wordCount);
  let lineNo = 0;
  let scanFrom = 0;
  for (let i = 0; i < wordCount; i++) {
    for (let pos = scanFrom; pos < tokens[i].start; pos++) {
      if (text.charCodeAt(pos) === 10) {
        lineNo++;
      }
    }
    scanFrom = tokens[i].start;
    tokenLines[i] = lineNo;
  }

  const measure = (from, to) => {
    let familyTokenCount = 0;
    let lineEndRhymeCount = 0;
    let internalRhymeCount = 0;
    const linesByFamily = new Map();
    const occurrencesByFamily = new Map();
    for (let i = from; i < to; i++) {
      const familyId = tokens[i].familyId;
      if (!familyId) {
        continue;
      }
      familyTokenCount++;
      if (i === to - 1 || tokenLines[i] !== tokenLines[i + 1]) {
        lineEndRhymeCount++;
      } else {
        internalRhymeCount++;
      }
      let lines = linesByFamily.get(familyId);
      if (!lines) {
        lines = new Set();
        linesByFamily.set(familyId, lines);
      }
      lines.add(tokenLines[i]);
      let occurrences = occurrencesByFamily.get(familyId);
      if (!occurrences) {
        occurrences = [];
        occurrencesByFamily.set(familyId, occurrences);
      }
      occurrences.push(i);
    }

    // Spacing: distance (in word positions) between consecutive occurrences of
    // the same family — how tightly rhymes cluster within the text.
    const gaps = [];
    for (const occurrences of occurrencesByFamily.values()) {
      for (let i = 1; i < occurrences.length; i++) {
        gaps.push(occurrences[i] - occurrences[i - 1]);
      }
    }

    const count = to - from;
    return {
      wordCount: count,
      familyCount: occurrencesByFamily.size,
      rhymeDensity: count > 0 ? familyTokenCount / count : 0,
      internalRhymeCount,
      lineEndRhymeCount,
      avgRhymeSpacing: gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null,
      recurringFamilyShare:
        occurrencesByFamily.size > 0
          ? [...linesByFamily.values()].filter((lines) => lines.size >= 2).length / occurrencesByFamily.size
          : null,
    };
  };

  // Token range per stanza (stanzas are non-overlapping and ordered, so a
  // single forward pass maps each to [firstTokenIndex, lastTokenIndex]).
  const sections = [];
  if (wordCount > 0) {
    let tokenCursor = 0;
    for (const [rangeStart, rangeEnd] of stanzaRanges(text)) {
      while (tokenCursor < wordCount && tokens[tokenCursor].start < rangeStart) {
        tokenCursor++;
      }
      const firstTokenIndex = tokenCursor;
      while (tokenCursor < wordCount && tokens[tokenCursor].start < rangeEnd) {
        tokenCursor++;
      }
      const lastTokenIndex = tokenCursor - 1;
      if (lastTokenIndex < firstTokenIndex) {
        continue; // Stanza with no words (punctuation/decoration only).
      }
      sections.push({
        index: sections.length,
        firstTokenIndex,
        lastTokenIndex,
        lineStart: tokenLines[firstTokenIndex] + 1,
        lineEnd: tokenLines[lastTokenIndex] + 1,
        metrics: measure(firstTokenIndex, lastTokenIndex + 1),
      });
    }
  }

  return {
    wordCount,
    uniqueWordCount,
    // Repeated words measured separately so choruses don't inflate rhyme stats.
    repetitionRate: wordCount > 0 ? 1 - uniqueWordCount / wordCount : 0,
    ...measure(0, wordCount),
    sections,
  };
}

async function analyseText(text) {
  const tokens = tokenize(text);
  const uniqueWords = [...new Set(tokens.map((token) => token.word))];

  if (uniqueWords.length === 0) {
    return {
      analysisVersion: ANALYSIS_VERSION,
      status: "empty",
      families: [],
      tokens: [],
      metrics: null,
      stats: { failedLookupCount: 0 },
    };
  }

  const rhymeSets = new Map();
  await mapLimit(uniqueWords, DATAMUSE_CONCURRENCY, async (word) => {
    rhymeSets.set(word, await lookupRhymes(word));
  });
  const failedLookupCount = uniqueWords.filter((word) => rhymeSets.get(word) === null).length;

  if (failedLookupCount === uniqueWords.length) {
    return {
      analysisVersion: ANALYSIS_VERSION,
      status: "failed",
      error: "The rhyme service could not be reached, so no rhymes could be identified.",
      families: [],
      tokens: [],
      metrics: null,
      stats: { failedLookupCount },
    };
  }

  const firstIndexOfWord = new Map();
  tokens.forEach((token, index) => {
    if (!firstIndexOfWord.has(token.word)) {
      firstIndexOfWord.set(token.word, index);
    }
  });

  // Clipped spellings ("hustlin", "ridin") are matched through their +g forms.
  const aliasOwners = new Map();
  for (const word of uniqueWords) {
    if (CLIPPED_IN_RE.test(word) && word.length >= 5) {
      aliasOwners.set(`${word}g`, word);
    }
  }

  const families = buildWordFamilies(uniqueWords, rhymeSets, firstIndexOfWord, aliasOwners);
  const familyIdByWord = new Map(
    families.flatMap((family) => family.words.map((word) => [word, family.id]))
  );
  const outTokens = tokens.map((token) => ({
    ...token,
    familyId: familyIdByWord.get(token.word) ?? null,
  }));
  for (const family of families) {
    family.count = outTokens.reduce(
      (count, token) => count + (token.familyId === family.id ? 1 : 0),
      0
    );
  }

  return {
    analysisVersion: ANALYSIS_VERSION,
    status: failedLookupCount > 0 ? "partial" : "ready",
    families,
    tokens: outTokens,
    metrics: computeMetrics(text, outTokens),
    stats: { failedLookupCount },
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

function requireArtistId(req, res) {
  const artistId = req.params.id;
  if (!/^\d+$/.test(artistId)) {
    sendApiError(res, new ApiError(400, "bad_request", "Artist id must be a numeric Genius id"));
    return null;
  }
  return artistId;
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

// Note: defined before /api/artists/:id so "lookup" is not captured as an id.
app.get("/api/artists/lookup", async (req, res) => {
  try {
    const name = String(req.query.name ?? "").trim();
    if (!name || name.length > 200) {
      throw new ApiError(400, "bad_request", "Missing or invalid required query parameter: name");
    }
    const artist = await lookupArtistByName(name);
    res.json({ artist });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/artists/:id", async (req, res) => {
  try {
    const artistId = requireArtistId(req, res);
    if (!artistId) return;
    const artist = await getGeniusArtist(artistId);
    res.json({ artist });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/artists/:id/songs", async (req, res) => {
  try {
    const artistId = requireArtistId(req, res);
    if (!artistId) return;
    const page = Math.trunc(Number(req.query.page) || 1);
    if (!Number.isInteger(page) || page < 1 || page > 50) {
      throw new ApiError(400, "bad_request", "page must be an integer between 1 and 50");
    }
    const cacheKey = `${artistId}:${page}`;
    const cached = artistSongsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < ARTIST_CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }
    const data = await geniusRequest(`/artists/${artistId}/songs`, {
      page: String(page),
      per_page: "20",
    });
    const songs = (Array.isArray(data?.response?.songs) ? data.response.songs : [])
      .filter(Boolean)
      .map(normalizeSong);
    const payload = { songs, nextPage: data?.response?.next_page ?? null };
    artistSongsCache.set(cacheKey, { payload, fetchedAt: Date.now() });
    res.json(payload);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/artists/:id/similar", async (req, res) => {
  try {
    const artistId = requireArtistId(req, res);
    if (!artistId) return;
    const artist = await getGeniusArtist(artistId);
    const result = await getSimilarArtists(artist.name);
    res.json({ artistId, ...result });
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
