import { useCallback, useEffect, useRef, useState } from "react";
import LyricsReader from "./components/LyricsReader";
import PasteLyricsBox from "./components/PasteLyricsBox";
import SongResults from "./components/SongResults";
import { requestJson } from "./util/api";
import "./App.css";

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return { q: (params.get("q") || "").trim(), song: params.get("song") || "" };
}

function pushUrl({ q, song }) {
  const params = new URLSearchParams();
  if (q) {
    params.set("q", q);
  }
  if (song) {
    params.set("song", song);
  }
  const search = params.toString();
  window.history.pushState({}, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}

// Search and song state are guarded by sequence numbers so a slow response can
// never overwrite the results of a newer search or song selection.
function App() {
  const initialParams = useRef(readUrlParams());
  const [inputValue, setInputValue] = useState(initialParams.current.q);
  const [query, setQuery] = useState(initialParams.current.q);
  const [search, setSearch] = useState({ status: "idle", results: null, error: null });
  const [session, setSession] = useState(() => {
    const { song } = initialParams.current;
    return song && /^\d+$/.test(song) ? { kind: "song", songId: song } : null;
  });
  const [songs, setSongs] = useState({}); // songId -> { meta, lyrics, analysis }
  const [paste, setPaste] = useState(null); // { lyrics, analysis } for pasted text

  const searchSeq = useRef(0);
  const songSeq = useRef({});
  const analysisSeq = useRef({});
  const songsRef = useRef({});

  const patchSong = useCallback((songId, patch) => {
    songsRef.current = {
      ...songsRef.current,
      [songId]: { ...songsRef.current[songId], ...patch },
    };
    setSongs(songsRef.current);
  }, []);

  const analyseSong = useCallback(
    async (songId, text) => {
      const seq = (analysisSeq.current[songId] = (analysisSeq.current[songId] || 0) + 1);
      patchSong(songId, {
        analysis: { status: "loading", families: null, tokens: null, error: null },
      });
      try {
        const data = await requestJson("/api/highlight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (analysisSeq.current[songId] !== seq) {
          return;
        }
        patchSong(songId, {
          analysis: {
            status: data.status,
            families: data.families,
            tokens: data.tokens,
            error: data.error ?? null,
          },
        });
      } catch (error) {
        if (analysisSeq.current[songId] !== seq) {
          return;
        }
        patchSong(songId, {
          analysis: { status: "failed", families: null, tokens: null, error: error.message },
        });
      }
    },
    [patchSong]
  );

  const loadSong = useCallback(
    async (songId) => {
      const seq = (songSeq.current[songId] = (songSeq.current[songId] || 0) + 1);
      const stale = () => songSeq.current[songId] !== seq;

      const record = songsRef.current[songId];
      const reusable =
        record?.meta?.status === "ready" &&
        ["available", "unavailable", "pasted"].includes(record.lyrics?.status) &&
        (record.lyrics.status !== "available" ||
          ["ready", "partial", "empty", "failed"].includes(record.analysis?.status));
      if (reusable) {
        return;
      }

      patchSong(songId, {
        meta: { status: "loading", song: null, error: null },
        lyrics: { status: "idle", text: null, error: null },
        analysis: { status: "idle", families: null, tokens: null, error: null },
      });

      try {
        const data = await requestJson(`/api/songs/${songId}`);
        if (stale()) {
          return;
        }
        patchSong(songId, { meta: { status: "ready", song: data.song, error: null } });
      } catch (error) {
        if (stale()) {
          return;
        }
        patchSong(songId, {
          meta: {
            status: error.code === "catalogue_unavailable" ? "unavailable" : "error",
            song: null,
            error: error.message,
          },
        });
        return; // Without song metadata (artist/title) there is nothing to fetch lyrics for.
      }

      try {
        const data = await requestJson(`/api/songs/${songId}/lyrics`);
        if (stale()) {
          return;
        }
        patchSong(songId, {
          lyrics: {
            status: data.status,
            text: data.text ?? null,
            error: data.message ?? null,
            provenance: data.provenance ?? null,
          },
        });
        if (data.status === "available" && data.text) {
          await analyseSong(songId, data.text);
        }
      } catch (error) {
        if (stale()) {
          return;
        }
        patchSong(songId, {
          lyrics: { status: "error", text: null, error: error.message },
        });
      }
    },
    [analyseSong, patchSong]
  );

  const runSearch = useCallback(async (rawQuery) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      return;
    }
    const seq = ++searchSeq.current;
    setSearch({ status: "searching", results: null, error: null });
    try {
      const data = await requestJson(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (seq !== searchSeq.current) {
        return;
      }
      setSearch({
        status: data.songs.length > 0 || data.artists.length > 0 ? "ready" : "empty",
        results: data,
        error: null,
      });
    } catch (error) {
      if (seq !== searchSeq.current) {
        return;
      }
      setSearch({
        status: error.code === "catalogue_unavailable" ? "unavailable" : "error",
        results: null,
        error: error.message,
      });
    }
  }, []);

  const submitSearch = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    setInputValue(trimmed);
    setQuery(trimmed);
    pushUrl({ q: trimmed, song: session?.kind === "song" ? session.songId : "" });
    runSearch(trimmed);
  };

  const openSong = useCallback(
    (songId, { push = true } = {}) => {
      setSession({ kind: "song", songId });
      if (push) {
        pushUrl({ q: query, song: songId });
      }
      loadSong(songId);
    },
    [loadSong, query]
  );

  const analyzePaste = useCallback(async (text) => {
    setPaste({
      lyrics: { status: "available", text, error: null },
      analysis: { status: "loading", families: null, tokens: null, error: null },
    });
    setSession({ kind: "text" });
    try {
      const data = await requestJson("/api/highlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setPaste((prev) => ({
        ...prev,
        analysis: {
          status: data.status,
          families: data.families,
          tokens: data.tokens,
          error: data.error ?? null,
        },
      }));
    } catch (error) {
      setPaste((prev) => ({
        ...prev,
        analysis: { status: "failed", families: null, tokens: null, error: error.message },
      }));
    }
  }, []);

  // Restore state from the URL on first load.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) {
      return;
    }
    didInit.current = true;
    const { q, song } = initialParams.current;
    if (q) {
      runSearch(q);
    }
    if (song && /^\d+$/.test(song)) {
      openSong(song, { push: false });
    }
  }, [openSong, runSearch]);

  // Keep browser history navigation (back/forward) in sync with app state.
  useEffect(() => {
    const handlePopState = () => {
      const { q, song } = readUrlParams();
      setInputValue(q);
      setQuery(q);
      if (q) {
        runSearch(q);
      } else {
        searchSeq.current++;
        setSearch({ status: "idle", results: null, error: null });
      }
      if (song && /^\d+$/.test(song)) {
        openSong(song, { push: false });
      } else {
        setSession(null);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [openSong, runSearch]);

  const sessionRecord = session?.kind === "song" ? songs[session.songId] : null;

  const songResults = (
    <SongResults
      status={search.status}
      results={search.results}
      error={search.error}
      query={query}
      onOpenSong={(songId) => openSong(songId)}
      onArtistSearch={submitSearch}
      onRetry={() => query && runSearch(query)}
    />
  );

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-header__brand">Rhymes Highlighter</span>
        <form
          className="app-header__search"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch(inputValue);
          }}
          role="search"
        >
          <input
            type="search"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="Search songs or artists"
            aria-label="Search songs or artists"
          />
          <button type="submit" className="button">
            Search
          </button>
        </form>
      </header>

      {session ? (
        <main className="layout layout--with-session">
          <div className="layout__reader">
            {session.kind === "song" && sessionRecord && (
              <LyricsReader
                key={`song-${session.songId}`}
                meta={sessionRecord.meta ?? { status: "loading" }}
                lyrics={sessionRecord.lyrics ?? { status: "idle" }}
                analysis={sessionRecord.analysis ?? { status: "idle" }}
                onRetrySong={() => loadSong(session.songId)}
                onRetryAnalysis={() =>
                  sessionRecord.lyrics?.text && analyseSong(session.songId, sessionRecord.lyrics.text)
                }
                onPasteText={(text) => {
                  patchSong(session.songId, { lyrics: { status: "pasted", text, error: null } });
                  analyseSong(session.songId, text);
                }}
              />
            )}
            {session.kind === "text" && paste && (
              <LyricsReader
                key="text"
                meta={{ status: "ready" }}
                lyrics={paste.lyrics}
                analysis={paste.analysis}
                onRetrySong={() => {}}
                onRetryAnalysis={() => paste.lyrics?.text && analyzePaste(paste.lyrics.text)}
                onPasteText={analyzePaste}
              />
            )}
          </div>
          <div className="layout__results">{songResults}</div>
        </main>
      ) : (
        <main className="layout layout--home">
          {songResults}
          <section className="hero" aria-label="Paste your own lyrics">
            <h2>See the rhymes inside a song</h2>
            <p>
              Search for a song by title or artist, or paste lyrics directly. Every word is coloured by
              the rhyme family it belongs to — select a family to see where it recurs.
            </p>
            <PasteLyricsBox onAnalyze={analyzePaste} />
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
