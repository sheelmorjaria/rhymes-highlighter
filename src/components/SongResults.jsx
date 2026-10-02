import SongCard from "./SongCard";

// Search results with explicit states: searching, results, no results, error
// and catalogue-unavailable. Artist suggestions are derived from the song
// results and labelled as such — they open the artist page when the name can
// be resolved to the Genius catalogue.
const SongResults = ({ status, results, error, query, onOpenSong, onOpenArtist, onRetry }) => {
  if (status === "idle") {
    return null;
  }

  return (
    <section className="results" aria-label="Search results">
      {status === "searching" && <p className="status status--loading">Searching…</p>}

      {status === "empty" && (
        <div className="panel" role="status">
          <p className="panel__message">
            No songs matched “{query}”. Try different words — or paste lyrics to analyse directly.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="panel" role="alert">
          <p className="panel__message panel__message--error">
            Search failed: {error}{" "}
            <button type="button" className="link-button" onClick={onRetry}>
              Retry
            </button>
          </p>
        </div>
      )}

      {status === "unavailable" && (
        <div className="panel" role="alert">
          <p className="panel__message">
            Song search is unavailable because the Genius catalogue is not configured on this server
            (missing GENIUS_ACCESS_TOKEN). You can still paste lyrics to get rhyme highlighting.
          </p>
        </div>
      )}

      {status === "ready" && results && (
        <>
          {results.artists?.length > 0 && (
            <div className="artist-suggestions">
              <h3 className="results__heading">Artist suggestions</h3>
              <p className="results__hint">Derived from these song results — not a full artist search.</p>
              <ul className="artist-chips">
                {results.artists.map((artist) => (
                  <li key={artist.id}>
                    <button type="button" className="artist-chips__chip" onClick={() => onOpenArtist(artist.name)}>
                      {artist.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h3 className="results__heading">Songs</h3>
          {results.songs.length === 0 ? (
            <p className="results__hint">No songs in these results.</p>
          ) : (
            <ul className="song-list">
              {results.songs.map((song) => (
                <li key={song.id}>
                  <SongCard song={song} onOpen={onOpenSong} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default SongResults;
