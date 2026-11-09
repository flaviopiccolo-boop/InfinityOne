import ActionMenu from "./ActionMenu";
import Rating from "./Rating";
import { findSmartPlaylist } from "../lib/smartPlaylists";
import { formatDuration } from "../hooks/useTrackMetadata";
import type { TrackMetadata } from "../hooks/useTrackMetadata";
import { trackFormat, trackName, trackTitle } from "../lib/tracks";
import type { Playlist, Track, TrackId, View } from "../types";

type TrackListProps = {
  view: View | undefined;
  /** The open playlist, if any. */
  playlist: Playlist | undefined;
  playlists: Playlist[];
  /** Tracks in the open collection, before search. */
  tracks: Track[];
  /** Library tracks that can be added to the open playlist. */
  availableTracks: Track[];
  search: string;
  active: TrackId | undefined;
  metadata: Record<TrackId, TrackMetadata>;
  favorites: Set<TrackId>;
  loading: boolean;
  busy: boolean;
  onPlay: (track: TrackId) => void;
  onToggleFavorite: (track: TrackId) => void;
  onSchedule: (track: TrackId, placement: "next" | "end") => void;
  onSetPlaylistTrack: (playlist: Playlist, track: TrackId, included: boolean) => void;
  onRemove: (track: Track) => void;
  onRate: (track: TrackId, rating: number | null) => void;
};

export default function TrackList({
  view, playlist, playlists, tracks, availableTracks, search, active, metadata, favorites, loading, busy,
  onPlay, onToggleFavorite, onSchedule, onSetPlaylistTrack, onRemove, onRate,
}: TrackListProps) {
  const title = (track: Track) => trackTitle(track, metadata[track.id]);
  const query = search.trim().toLocaleLowerCase();
  const matches = tracks
    .map((track, index) => ({ track, position: index + 1 }))
    .filter(({ track }) => {
      const tags = metadata[track.id];
      return [trackName(track), tags?.title, tags?.artist, tags?.album, tags?.genre, tags?.comment, tags?.lyrics,
        tags?.generator?.name]
        .some((value) => value?.toLocaleLowerCase().includes(query));
    });
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
              actions: availableTracks.map((track) => ({
                id: String(track.id),
                icon: "track",
                label: title(track),
                onSelect: () => onSetPlaylistTrack(playlist, track.id, true),
              })),
            }]} />
        )}
      </div>
      {loading ? (
        <p className="empty" role="status">Loading library…</p>
      ) : tracks.length === 0 ? (
        <p className="empty">{findSmartPlaylist(view)?.empty ?? (view === "favorites"
          ? "Select the heart next to a track to add it here."
          : playlist && availableTracks.length
            ? "Choose a track from your library to add."
            : "Import MP3 or WAV files to get started.")}</p>
      ) : matches.length === 0 ? (
        <p className="empty" role="status">No tracks match your search.</p>
      ) : (
        <ol className="tracks">
          {matches.map(({ track, position }) => {
            const { id } = track;
            const tags = metadata[id];
            const details = track.missing
              ? "File not found"
              : [tags?.generator?.name, tags?.artist, tags?.album, tags?.genre].filter(Boolean).join(" · ");
            const favorite = favorites.has(id);
            return (
              <li className="track-row" key={id} data-missing={track.missing || undefined}>
                <button className="track" aria-current={id === active ? "true" : undefined}
                  title={track.location} onClick={() => onPlay(id)}>
                  <span className="track-index" aria-hidden="true">{id === active ? "♪" : position}</span>
                  <span className="track-text">
                    <span className="truncate">{title(track)}</span>
                    {details && <span className="track-caption truncate">{details}</span>}
                  </span>
                  <span className="format">
                    {trackFormat(track)}
                    {tags && tags.durationSeconds > 0 ? ` · ${formatDuration(tags.durationSeconds)}` : ""}
                  </span>
                </button>
                <Rating compact value={track.rating} label={trackName(track)} disabled={busy}
                  onChange={(rating) => onRate(id, rating)} />
                <button className="favorite-button" type="button" disabled={busy}
                  aria-label={`Favorite ${trackName(track)}`} aria-pressed={favorite}
                  title={favorite ? "Remove from favorites" : "Add to favorites"}
                  onClick={() => onToggleFavorite(id)}>
                  <span aria-hidden="true">{favorite ? "♥" : "♡"}</span>
                </button>
                <ActionMenu label={`More actions for ${title(track)}`} icon="more" groups={[
                  { actions: [
                    { id: "next", icon: "next", label: "Play next", disabled: id === active,
                      onSelect: () => onSchedule(id, "next") },
                    { id: "queue", icon: "queue", label: "Add to queue", disabled: id === active,
                      onSelect: () => onSchedule(id, "end") },
                    playlist ? {
                      id: "remove", icon: "remove" as const, label: "Remove from playlist", disabled: busy,
                      onSelect: () => onSetPlaylistTrack(playlist, id, false),
                    } : {
                      id: "remove", icon: "delete" as const, label: "Remove from library", disabled: busy,
                      onSelect: () => onRemove(track),
                    },
                  ] },
                  ...(!playlist && playlists.length ? [{
                    label: "Add to playlist",
                    actions: playlists.map((item) => ({
                      id: String(item.id),
                      icon: "playlist" as const,
                      label: item.name,
                      disabled: busy || item.tracks.includes(id),
                      onSelect: () => onSetPlaylistTrack(item, id, true),
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
