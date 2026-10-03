import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArtistContext from "./components/ArtistContext";
import ArtistPage from "./components/ArtistPage";
import LyricsReader from "./components/LyricsReader";
import PasteLyricsBox from "./components/PasteLyricsBox";
import RecentlyOpened from "./components/RecentlyOpened";
import SongResults from "./components/SongResults";
import { requestJson } from "./util/api";
import {
  loadAnalysisIndex,
  persistAnalysisIndex,
  upsertAnalysisEntry,
} from "./util/analysisIndex";
import "./App.css";

const RECENT_STORAGE_KEY = "rhymes.recent";

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const numeric = (value) => (/^\d+$/.test(value) ? value : "");
  return {
    q: (params.get("q") || "").trim(),
    song: numeric(params.get("song") || ""),
    artist: numeric(params.get("artist") || ""),
  };
}

function pushUrl({ q, song, artist }) {
  const params = new URLSearchParams();
  if (q) {
    params.set("q", q);
  }
  if (song) {
    params.set("song", song);
  }
  if (artist) {
    params.set("artist", artist);
  }
  const search = params.toString();
  window.history.pushState({}, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}

// Search, song and artist state are guarded by sequence numbers so a slow
// response can never overwrite the results of a newer navigation.
function App() {
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ status: "idle", results: null, error: null });
  // session: { kind: "song", songId, artistId } | { kind: "artist", artistId }
  //          | { kind: "text" } | null
  const [session, setSession] = useState(null);
  const [songs, setSongs] = useState({}); // songId -> { meta, lyrics, analysis }
  const [artists, setArtists] = useState({}); // artistId -> { meta, songs, similar }
  const [paste, setPaste] = useState(null); // { lyrics, analysis } for pasted text
  const [analysisIndex, setAnalysisIndex] = useState(loadAnalysisIndex);
  const [recent, setRecent] = useState(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch {
      return [];
    }
  });

  const searchSeq = useRef(0);
  const songSeq = useRef({});
  const analysisSeq = useRef({});
  const artistSeq = useRef({});
  const songsRef = useRef({});
  const artistsRef = useRef({});

  useEffect(() => {
    try {
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent));
    } catch {
      // Storage unavailable (private mode etc.) — the trail just won't persist.
    }
  }, [recent]);

  useEffect(() => {
    persistAnalysisIndex(analysisIndex);
  }, [analysisIndex]);

  const pushRecent = useCallback((entry) => {
    setRecent((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)].slice(0, 8));
  }, []);

  const patchSong = useCallback((songId, patch) => {
    songsRef.current = {
      ...songsRef.current,
      [songId]: { ...songsRef.current[songId], ...patch },
    };
    setSongs(songsRef.current);
  }, []);

  const patchArtist = useCallback((artistId, patch) => {
    artistsRef.current = {
      ...artistsRef.current,
      [artistId]: { ...artistsRef.current[artistId], ...patch },
    };
    setArtists(artistsRef.current);
  }, []);

  // ---------------------------------------------------------------- analysing

  // Record a finished analysis in the local analysed-songs index so it can be
  // compared against and searched for shared rhyme sounds later.
  const recordAnalysis = useCallback((songId, data) => {
    const meta = songsRef.current[songId]?.meta?.song;
    if (!meta || !data.metrics) {
      return;
    }
    const entry = {
      id: String(songId),
      title: meta.title,
      artistNames: meta.artistNames,
      artistId: meta.artist?.id ?? null,
      metrics: data.metrics,
      families: (data.families ?? []).map((family) => ({
        id: family.id,
        label: family.label,
        words: family.words ?? [],
      })),
      analysedAt: Date.now(),
    };
    setAnalysisIndex((prev) => upsertAnalysisEntry(prev, entry));
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
        recordAnalysis(songId, data);
      } catch (error) {
        if (analysisSeq.current[songId] !== seq) {
          return;
        }
        patchSong(songId, {
          analysis: { status: "failed", families: null, tokens: null, error: error.message },
        });
      }
    },
    [patchSong, recordAnalysis]
  );

  // ------------------------------------------------------------------- songs

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
        lyrics: { status: "idle", text: null, error: null, provenance: null },
        analysis: { status: "idle", families: null, tokens: null, error: null },
      });

      try {
        const data = await requestJson(`/api/songs/${songId}`);
        if (stale()) {
          return;
        }
        patchSong(songId, { meta: { status: "ready", song: data.song, error: null } });
        pushRecent({
          id: String(songId),
          title: data.song.title,
          artistNames: data.song.artistNames,
          artistId: data.song.artist?.id ?? null,
        });
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
          lyrics: { status: "error", text: null, error: error.message, provenance: null },
        });
      }
    },
    [analyseSong, patchSong, pushRecent]
  );

  // ----------------------------------------------------------------- artists

  const loadArtist = useCallback(
    async (artistId) => {
      const seq = (artistSeq.current[artistId] = (artistSeq.current[artistId] || 0) + 1);
      const stale = () => artistSeq.current[artistId] !== seq;
      const record = artistsRef.current[artistId] ?? {};

      const jobs = [];

      if (record.meta?.status !== "ready") {
        patchArtist(artistId, { meta: { status: "loading", artist: null, error: null } });
        jobs.push((async () => {
          try {
            const data = await requestJson(`/api/artists/${artistId}`);
            if (stale()) return;
            patchArtist(artistId, { meta: { status: "ready", artist: data.artist, error: null } });
          } catch (error) {
            if (stale()) return;
            patchArtist(artistId, {
              meta: {
                status: error.code === "catalogue_unavailable" ? "unavailable" : "error",
                artist: null,
                error: error.message,
              },
            });
          }
        })());
      }

      if (!record.songs || ["idle", "error"].includes(record.songs.status)) {
        patchArtist(artistId, {
          songs: { status: "loading", list: [], page: 0, nextPage: null, error: null },
        });
        jobs.push((async () => {
          try {
            const data = await requestJson(`/api/artists/${artistId}/songs?page=1`);
            if (stale()) return;
            patchArtist(artistId, {
              songs: { status: "ready", list: data.songs, page: 1, nextPage: data.nextPage, error: null },
            });
          } catch (error) {
            if (stale()) return;
            patchArtist(artistId, {
              songs: { status: "error", list: [], page: 0, nextPage: null, error: error.message },
            });
          }
        })());
      }

      if (!record.similar || ["idle", "error"].includes(record.similar.status)) {
        patchArtist(artistId, { similar: { status: "loading", list: [], error: null } });
        jobs.push((async () => {
          try {
            const data = await requestJson(`/api/artists/${artistId}/similar`);
            if (stale()) return;
            patchArtist(artistId, {
              similar: {
                status: data.status,
                list: data.artists ?? [],
                source: data.source ?? null,
                error: data.message ?? null,
              },
            });
          } catch (error) {
            if (stale()) return;
            patchArtist(artistId, {
              similar: { status: "error", list: [], source: null, error: error.message },
            });
          }
        })());
      }

      await Promise.all(jobs);
    },
    [patchArtist]
  );

  const loadMoreArtistSongs = useCallback(
    async (artistId, page) => {
      const record = artistsRef.current[artistId];
      const known = new Set((record?.songs?.list ?? []).map((song) => song.id));
      patchArtist(artistId, { songs: { ...record.songs, status: "loading-more" } });
      try {
        const data = await requestJson(`/api/artists/${artistId}/songs?page=${page}`);
        patchArtist(artistId, {
          songs: {
            status: "ready",
            list: [...record.songs.list, ...data.songs.filter((song) => !known.has(song.id))],
            page,
            nextPage: data.nextPage,
            error: null,
          },
        });
      } catch (error) {
        patchArtist(artistId, {
          songs: { ...record.songs, status: "error", error: error.message },
        });
      }
    },
    [patchArtist]
  );

  // ------------------------------------------------------------------ search

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

  // --------------------------------------------------------------- navigation

  const submitSearch = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    setInputValue(trimmed);
    setQuery(trimmed);
    pushUrl({
      q: trimmed,
      song: session?.kind === "song" ? session.songId : "",
      artist: session?.artistId ?? "",
    });
    runSearch(trimmed);
  };

  const openSong = (songId, artistId = null, { push = true } = {}) => {
    setSession({ kind: "song", songId: String(songId), artistId: artistId ? String(artistId) : null });
    if (push) {
      pushUrl({ q: query, song: String(songId), artist: artistId ? String(artistId) : "" });
    }
    loadSong(songId);
    if (artistId && artistsRef.current[artistId]?.meta?.status !== "ready") {
      loadArtist(artistId); // Sidebar context: songs by the same artist.
    }
  };

  const openArtist = (artistId, { push = true } = {}) => {
    setSession({ kind: "artist", artistId: String(artistId) });
    if (push) {
      pushUrl({ q: query, song: "", artist: String(artistId) });
    }
    loadArtist(artistId);
  };

  // Similar artists come from Last.fm by name; resolve the name back into the
  // Genius catalogue. If resolution fails, fall back to a plain search.
  const openArtistByName = async (name) => {
    try {
      const data = await requestJson(`/api/artists/lookup?name=${encodeURIComponent(name)}`);
      openArtist(data.artist.id);
    } catch {
      submitSearch(name);
    }
  };

  const analyzePaste = useCallback(async (text) => {
    setPaste({
      lyrics: { status: "available", text, error: null, provenance: null },
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

  // Restore app state from the URL — on first load and on back/forward.
  const restoreFromUrl = () => {
    const { q, song, artist } = readUrlParams();
    setInputValue(q);
    setQuery(q);
    if (q) {
      runSearch(q);
    } else {
      searchSeq.current++;
      setSearch({ status: "idle", results: null, error: null });
    }
    if (song) {
      openSong(song, artist || null, { push: false });
    } else if (artist) {
      openArtist(artist, { push: false });
    } else {
      setSession(null);
    }
  };

  const navRef = useRef({});
  navRef.current = { restoreFromUrl };
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) {
      return;
    }
    didInit.current = true;
    navRef.current.restoreFromUrl();
  }, []);
  useEffect(() => {
    const handlePopState = () => navRef.current.restoreFromUrl();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // ------------------------------------------------------------------ render

  const sessionRecord = session?.kind === "song" ? songs[session.songId] : null;
  const artistRecord = session?.artistId ? artists[session.artistId] : null;

  // Artist-level pattern summary from the analysed-songs index (sample = the
  // analysed songs only, and the UI says exactly how many that is).
  const artistPatterns = useMemo(() => {
    if (session?.kind !== "artist") {
      return null;
    }
    const songsForArtist = analysisIndex.filter(
      (entry) => String(entry.artistId) === session.artistId
    );
    return { count: songsForArtist.length, songs: songsForArtist };
  }, [analysisIndex, session]);

  const songResults = (
    <SongResults
      status={search.status}
      results={search.results}
      error={search.error}
      query={query}
      onOpenSong={(song) => openSong(song.id)}
      onOpenArtist={openArtistByName}
      onRetry={() => query && runSearch(query)}
    />
  );

  const recentlyOpened = (
    <RecentlyOpened items={recent} onOpen={(item) => openSong(item.id, item.artistId)} />
  );

  const renderSidebar = () => {
    if (session?.kind === "song" && session.artistId && artistRecord) {
      const artistName = artistRecord.meta?.artist?.name ?? "Artist";
      if (artistRecord.songs?.list?.length) {
        return (
          <ArtistContext
            artistName={artistName}
            songs={artistRecord.songs.list}
            onOpenSong={(song) => openSong(song.id, session.artistId)}
            onOpenArtistPage={() => openArtist(session.artistId)}
          />
        );
      }
      if (artistRecord.songs?.status === "loading") {
        return <p className="status status--loading">Loading artist songs…</p>;
      }
    }
    if (search.status !== "idle") {
      return songResults;
    }
    return recentlyOpened;
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__left">
          <span className="app-header__brand">Rhymes Highlighter</span>
          {session && (
            <button type="button" className="link-button app-header__back" onClick={() => window.history.back()}>
              ← Back
            </button>
          )}
        </div>
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
          <div className="layout__main">
            {session.kind === "song" && sessionRecord && (
              <LyricsReader
                key={`song-${session.songId}`}
                songId={session.songId}
                analysisIndex={analysisIndex}
                onOpenSong={(songId, artistId) => openSong(songId, artistId)}
                meta={sessionRecord.meta ?? { status: "loading" }}
                lyrics={sessionRecord.lyrics ?? { status: "idle" }}
                analysis={sessionRecord.analysis ?? { status: "idle" }}
                onRetrySong={() => loadSong(session.songId)}
                onRetryAnalysis={() =>
                  sessionRecord.lyrics?.text && analyseSong(session.songId, sessionRecord.lyrics.text)
                }
                onPasteText={(text) => {
                  patchSong(session.songId, {
                    lyrics: { status: "pasted", text, error: null, provenance: null },
                  });
                  analyseSong(session.songId, text);
                }}
              />
            )}
            {session.kind === "artist" && (
              <ArtistPage
                record={artistRecord ?? {}}
                patterns={artistPatterns}
                onOpenSong={(song) => openSong(song.id, session.artistId)}
                onOpenSimilarArtist={openArtistByName}
                onLoadMoreSongs={(page) => loadMoreArtistSongs(session.artistId, page)}
                onRetry={() => loadArtist(session.artistId)}
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
          <div className="layout__side">{renderSidebar()}</div>
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
