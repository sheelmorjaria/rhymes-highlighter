import SongCard from "./SongCard";
import { METRICS, formatPercent } from "../util/metricsDisplay";

// An artist page answers three questions: who is this artist, which songs can
// I explore, and where can I go next (similar artists, when the discovery
// provider is configured — the page still works without it).
// Artist-level writing-pattern summary, aggregated from the analysed-songs
// index. The sample is always visible: the count of analysed songs and links
// to inspect each one — an average of two songs is exactly that.
const ArtistPatterns = ({ patterns, onOpenSong }) => {
  if (!patterns || patterns.count === 0) {
    return null;
  }
  const average = (key) => {
    const values = patterns.songs
      .map((entry) => entry.metrics?.[key])
      .filter((value) => typeof value === "number");
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };

  return (
    <section className="artist__patterns" aria-label="Writing patterns summary">
      <h3 className="results__heading">Writing patterns</h3>
      <p className="results__hint">
        Averages across {patterns.count} analysed {patterns.count === 1 ? "song" : "songs"} by this
        artist — not their whole catalogue.
        {patterns.count < 3 && " Small sample: analyse more songs for a steadier picture."}
      </p>
      <dl className="patterns__grid">
        {METRICS.map((metric) => (
          <div key={metric.key} className="patterns__cell">
            <dt title={metric.description}>{metric.label}</dt>
            <dd>{metric.format(average(metric.key))}</dd>
          </div>
        ))}
      </dl>
      <ul className="artist__patterns-list">
        {patterns.songs.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="link-button"
              onClick={() => onOpenSong({ id: entry.id })}
            >
              {entry.title}
            </button>{" "}
            <span className="results__hint">
              {formatPercent(entry.metrics?.rhymeDensity)} rhyme density
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

const ArtistPage = ({ record, patterns, onOpenSong, onOpenSimilarArtist, onLoadMoreSongs, onRetry }) => {
  const meta = record?.meta ?? { status: "loading" };
  const songs = record?.songs ?? { status: "idle", list: [], nextPage: null };
  const similar = record?.similar ?? { status: "idle", list: [] };
  const songList = Array.isArray(songs.list) ? songs.list : [];
  const similarList = Array.isArray(similar.list) ? similar.list : [];

  if (meta.status === "loading") {
    return (
      <article className="artist" aria-label="Artist page">
        <h2 className="reader__title reader__title--loading">Loading artist…</h2>
      </article>
    );
  }
  if (meta.status === "unavailable") {
    return (
      <article className="artist" aria-label="Artist page">
        <h2 className="reader__title">Artist</h2>
        <p className="reader__note reader__note--warn">
          Artist details are unavailable because the Genius catalogue is not configured on this
          server (missing GENIUS_ACCESS_TOKEN).
        </p>
      </article>
    );
  }
  if (meta.status === "error") {
    return (
      <article className="artist" aria-label="Artist page">
        <h2 className="reader__title">Artist</h2>
        <p className="reader__note reader__note--error">
          Could not load artist details: {meta.error}{" "}
          <button type="button" className="link-button" onClick={onRetry}>
            Retry
          </button>
        </p>
      </article>
    );
  }

  const artist = meta.artist;

  return (
    <article className="artist" aria-label={`Artist page for ${artist.name}`}>
      <header className="artist__header">
        {artist.imageUrl ? (
          <img className="artist__image" src={artist.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="artist__image artist__image--placeholder" aria-hidden="true">
            ♪
          </span>
        )}
        <div>
          <h2 className="reader__title">{artist.name}</h2>
          {artist.sourceUrl && (
            <p className="reader__subtitle">
              <a href={artist.sourceUrl} target="_blank" rel="noreferrer">
                View on Genius
              </a>
            </p>
          )}
        </div>
      </header>

      <section aria-label="Songs">
        <h3 className="results__heading">Songs</h3>
        {songs.status === "loading" && <p className="status status--loading">Loading songs…</p>}
        {songs.status === "error" && (
          <p className="status status--error">
            Could not load songs: {songs.error}{" "}
            <button type="button" className="link-button" onClick={onRetry}>
              Retry
            </button>
          </p>
        )}
        {songs.status === "ready" && songList.length === 0 && (
          <p className="results__hint">No songs listed for this artist.</p>
        )}
        {songList.length > 0 && (
          <ul className="song-list">
            {songList.map((song) => (
              <li key={song.id}>
                <SongCard song={song} onOpen={onOpenSong} />
              </li>
            ))}
          </ul>
        )}
        {songs.status === "ready" && songs.nextPage && (
          <button
            type="button"
            className="button button--more"
            onClick={() => onLoadMoreSongs(songs.nextPage)}
          >
            More songs
          </button>
        )}
      </section>

      <ArtistPatterns patterns={patterns} onOpenSong={onOpenSong} />

      <section className="artist__similar" aria-label="Similar artists">
        <h3 className="results__heading">Similar artists</h3>
        {similar.status === "loading" && <p className="status">Finding similar artists…</p>}
        {similar.status === "unavailable" && (
          <p className="results__hint">
            Similar-artist discovery is not configured on this server (missing LASTFM_API_KEY).
          </p>
        )}
        {similar.status === "error" && (
          <p className="results__hint">
            Similar artists are unavailable right now: {similar.error}{" "}
            <button type="button" className="link-button" onClick={onRetry}>
              Retry
            </button>
          </p>
        )}
        {similar.status === "available" &&
          (similarList.length === 0 ? (
            <p className="results__hint">No similar artists were found.</p>
          ) : (
            <ul className="similar-list">
              {similarList.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    className="similar-card"
                    onClick={() => onOpenSimilarArtist(entry.name)}
                  >
                    {entry.imageUrl ? (
                      <img className="similar-card__image" src={entry.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="similar-card__image similar-card__image--placeholder" aria-hidden="true">
                        ♪
                      </span>
                    )}
                    <span className="similar-card__name">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {similar.status === "available" && similar.source && (
          <p className="results__hint results__hint--attribution">Similar artists from {similar.source}</p>
        )}
      </section>
    </article>
  );
};

export default ArtistPage;
