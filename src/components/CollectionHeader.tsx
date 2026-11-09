import type { Playlist, View } from "../types";

type CollectionHeaderProps = {
  view: View | undefined;
  playlist: Playlist | undefined;
  trackCount: number;
  loading: boolean;
  busy: boolean;
  importingArchive: boolean;
  onRename: (playlist: Playlist) => void;
  onDelete: (playlist: Playlist) => void;
  onImportZip: () => void;
  onImportTracks: () => void;
};

export default function CollectionHeader({
  view, playlist, trackCount, loading, busy, importingArchive, onRename, onDelete, onImportZip, onImportTracks,
}: CollectionHeaderProps) {
  return (
    <header className={view === undefined ? "hero hero-home" : "hero"}>
      <div className="hero-copy">
        <div className="eyebrow">{playlist ? "Playlist" : "Your collection"}</div>
        <h1>{view === "favorites" ? "Favorites" : playlist?.name ?? "All your music in one place."}</h1>
        <p>{view === undefined ? "Your library, favorites, and playlists." : `${trackCount} ${trackCount === 1 ? "track" : "tracks"}`}</p>
      </div>
      <div className="hero-actions">
        {playlist && <button className="secondary" disabled={busy} onClick={() => onRename(playlist)}>Rename playlist</button>}
        {playlist && <button className="secondary" disabled={busy} onClick={() => onDelete(playlist)}>Delete playlist</button>}
        <button className="secondary" disabled={loading || busy} onClick={onImportZip}>
          {importingArchive ? "Importing ZIP…" : "Import ZIP"}
        </button>
        <button className="primary" disabled={loading || busy} onClick={onImportTracks}>Import tracks</button>
      </div>
    </header>
  );
}
