// A single song result row, shared by search results and artist song lists.
// The whole card is one button (no href="#" links); fullTitle carries version
// information (live/remix/translation) when Genius provides it.
const SongCard = ({ song, onOpen }) => (
  <button type="button" className="song-card" onClick={() => onOpen(song)}>
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
);

export default SongCard;
