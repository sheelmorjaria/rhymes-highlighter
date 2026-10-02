import SongCard from "./SongCard";

// Sidebar shown when a song was opened from an artist page: the rest of that
// artist's songs stay one click away while the reader holds the main column.
const ArtistContext = ({ artistName, songs, onOpenSong, onOpenArtistPage }) => (
  <section className="artist-context" aria-label={`More songs by ${artistName}`}>
    <h3 className="results__heading">{artistName}</h3>
    <ul className="song-list">
      {songs.slice(0, 8).map((song) => (
        <li key={song.id}>
          <SongCard song={song} onOpen={onOpenSong} />
        </li>
      ))}
    </ul>
    <button type="button" className="link-button" onClick={onOpenArtistPage}>
      View artist page →
    </button>
  </section>
);

export default ArtistContext;
