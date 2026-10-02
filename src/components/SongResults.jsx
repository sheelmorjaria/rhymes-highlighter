// Search results with explicit states: searching, results, no results, error
// and catalogue-unavailable. Song cards are buttons (no href="#" links);
// artist suggestions are derived from the song results and labelled as such.
const SongResults = ({ status, results, error, query, onOpenSong, onArtistSearch, onRetry }) => {
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
                    <button type="button" className="artist-chips__chip" onClick={() => onArtistSearch(artist.name)}>
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
                  <button type="button" className="song-card" onClick={() => onOpenSong(song.id)}>
                    {song.artworkUrl ? (
                      <img className="song-card__art" src={song.artworkUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="song-card__art song-card__art--placeholder" aria-hidden="true">
                        ♪
                      </span>
                    )}
                    <span className="song-card__body">
                      <span className="song-card__title">{song.title}</span>
                      <span className="song-card__artist">{song.artistNames}</span>
                      {song.fullTitle && song.fullTitle !== song.title && (
                        <span className="song-card__variant">{song.fullTitle}</span>
                      )}
                    </span>
                    <span className="song-card__action" aria-hidden="true">
                      Open
                    </span>
                  </button>
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
