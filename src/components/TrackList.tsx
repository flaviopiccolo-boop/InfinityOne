import ActionMenu from "./ActionMenu";
import { formatDuration } from "../hooks/useTrackMetadata";
import type { TrackMetadata } from "../hooks/useTrackMetadata";
import { trackName, trackTitle } from "../lib/tracks";
import type { Playlist, View } from "../types";

type TrackListProps = {
  view: View | undefined;
  /** The open playlist, if any. */
  playlist: Playlist | undefined;
  playlists: Playlist[];
  /** Tracks in the open collection, before search. */
  tracks: string[];
  /** Library tracks that can be added to the open playlist. */
  availableTracks: string[];
  search: string;
  active: string | undefined;
  metadata: Record<string, TrackMetadata>;
  favorites: Set<string>;
  loading: boolean;
  busy: boolean;
  onPlay: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  onSchedule: (path: string, placement: "next" | "end") => void;
  onSetPlaylistTrack: (playlist: Playlist, path: string, included: boolean) => void;
};

export default function TrackList({
  view, playlist, playlists, tracks, availableTracks, search, active, metadata, favorites, loading, busy,
  onPlay, onToggleFavorite, onSchedule, onSetPlaylistTrack,
}: TrackListProps) {
  const title = (path: string) => trackTitle(path, metadata[path]);
  const query = search.trim().toLocaleLowerCase();
  const matches = tracks
    .map((path, index) => ({ path, position: index + 1 }))
    .filter(({ path }) => [trackName(path), metadata[path]?.title, metadata[path]?.artist, metadata[path]?.album]
      .some((value) => value?.toLocaleLowerCase().includes(query)));
  const displayedCount = query ? matches.length : tracks.length;

  return (
    <section className="library" aria-label="Tracks">
      <div className="section-heading">
        <div className="section-title">
          <h2>{view === undefined ? "Local library" : "Tracks"}</h2>
          <span>{displayedCount} {displayedCount === 1 ? "track" : "tracks"}</span>
        </div>
        {playlist && availableTracks.length > 0 && (
          <ActionMenu label="Add tracks to playlist" icon="add" disabled={busy}
            groups={[{
              label: "Add tracks",
              actions: availableTracks.map((path) => ({
                id: path,
                icon: "track",
                label: title(path),
                onSelect: () => onSetPlaylistTrack(playlist, path, true),
              })),
            }]} />
        )}
      </div>
      {loading ? (
        <p className="empty" role="status">Loading library…</p>
      ) : tracks.length === 0 ? (
        <p className="empty">{view === "favorites"
          ? "Select the heart next to a track to add it here."
          : playlist && availableTracks.length
            ? "Choose a track from your library to add."
            : "Import MP3 or WAV files to get started."}</p>
      ) : matches.length === 0 ? (
        <p className="empty" role="status">No tracks match your search.</p>
      ) : (
        <ol className="tracks">
          {matches.map(({ path, position }) => {
            const tags = metadata[path];
            const details = [tags?.artist, tags?.album].filter(Boolean).join(" · ");
            const favorite = favorites.has(path);
            return (
              <li className="track-row" key={path}>
                <button className="track" aria-current={path === active ? "true" : undefined}
                  title={path} onClick={() => onPlay(path)}>
                  <span className="track-index" aria-hidden="true">{path === active ? "♪" : position}</span>
                  <span className="track-text">
                    <span className="truncate">{title(path)}</span>
                    {details && <span className="track-caption truncate">{details}</span>}
                  </span>
                  <span className="format">
                    {path.split(".").pop()?.toUpperCase()}
                    {tags && tags.durationSeconds > 0 ? ` · ${formatDuration(tags.durationSeconds)}` : ""}
                  </span>
                </button>
                <button className="favorite-button" type="button" disabled={busy}
                  aria-label={`Favorite ${trackName(path)}`} aria-pressed={favorite}
                  title={favorite ? "Remove from favorites" : "Add to favorites"}
                  onClick={() => onToggleFavorite(path)}>
                  <span aria-hidden="true">{favorite ? "♥" : "♡"}</span>
                </button>
                <ActionMenu label={`More actions for ${title(path)}`} icon="more" groups={[
                  { actions: [
                    { id: "next", icon: "next", label: "Play next", disabled: path === active,
                      onSelect: () => onSchedule(path, "next") },
                    { id: "queue", icon: "queue", label: "Add to queue", disabled: path === active,
                      onSelect: () => onSchedule(path, "end") },
                    ...(playlist ? [{
                      id: "remove", icon: "remove" as const, label: "Remove from playlist", disabled: busy,
                      onSelect: () => onSetPlaylistTrack(playlist, path, false),
                    }] : []),
                  ] },
                  ...(!playlist && playlists.length ? [{
                    label: "Add to playlist",
                    actions: playlists.map((item) => ({
                      id: String(item.id),
                      icon: "playlist" as const,
                      label: item.name,
                      disabled: busy || item.tracks.includes(path),
                      onSelect: () => onSetPlaylistTrack(item, path, true),
                    })),
                  }] : []),
                ]} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
