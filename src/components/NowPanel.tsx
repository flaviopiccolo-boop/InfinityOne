import Rating from "./Rating";
import type { TrackMetadata } from "../hooks/useTrackMetadata";
import type { TrackId } from "../types";

type NowPanelProps = {
  active: TrackId | undefined;
  title: string | undefined;
  artist: string | null | undefined;
  /** Tags of the active track, for its details. */
  tags: TrackMetadata | undefined;
  cover: string | undefined;
  onCoverError: () => void;
  favorite: boolean;
  rating: number | null;
  onRate: (track: TrackId, rating: number | null) => void;
  busy: boolean;
  onToggleFavorite: (track: TrackId) => void;
  /** The first upcoming tracks with their display titles. */
  upcoming: { id: TrackId; title: string }[];
  queueOpen: boolean;
  onToggleQueue: () => void;
  onSelect: (track: TrackId) => void;
};

export default function NowPanel({
  active, title, artist, tags, cover, onCoverError, favorite, rating, onRate, busy, onToggleFavorite,
  upcoming, queueOpen, onToggleQueue, onSelect,
}: NowPanelProps) {
  return (
    <aside className="now-panel" aria-labelledby="now-panel-title">
      <section className="now-card">
        <h2 id="now-panel-title">Now Playing</h2>
        <div className="now-cover" aria-hidden="true">
          {cover ? <img src={cover} alt="" onError={onCoverError} /> : <img src="/infinity-one.svg" alt="" className="cover-placeholder" />}
        </div>
        <div className="now-details">
          <div className="now-copy">
            <h3>{title ?? "Nothing playing yet"}</h3>
            <p>{artist ?? (active ? "Local track" : "Choose a track to get started.")}</p>
            {active !== undefined && title && (
              <Rating value={rating} label={title} disabled={busy} onChange={(stars) => onRate(active, stars)} />
            )}
          </div>
          {active && (
            <button className="favorite-button" type="button" disabled={busy} aria-label="Favorite current track"
              aria-pressed={favorite} onClick={() => onToggleFavorite(active)}>
              <span aria-hidden="true">{favorite ? "♥" : "♡"}</span>
            </button>
          )}
        </div>
        {tags && (tags.generator || tags.genre || tags.comment || tags.lyrics) && (
          <div className="now-info">
            {(tags.generator || tags.genre) && (
              <p className="now-tags">
                {tags.generator && <span className="tag-chip" title={tags.generator.url ?? undefined}>Made with {tags.generator.name}</span>}
                {tags.genre && <span className="tag-chip">{tags.genre}</span>}
              </p>
            )}
            {tags.comment && (
              <details>
                <summary>Description</summary>
                <p className="now-text">{tags.comment}</p>
              </details>
            )}
            {tags.lyrics && (
              <details>
                <summary>Lyrics</summary>
                <p className="now-text">{tags.lyrics}</p>
              </details>
            )}
          </div>
        )}
        <div className="now-queue">
          <div className="section-heading">
            <h2>Up next</h2>
            <button className="text-button" type="button" aria-expanded={queueOpen}
              aria-controls="playback-queue" onClick={onToggleQueue}>View queue</button>
          </div>
          {upcoming.length ? (
            <ol className="next-preview">
              {upcoming.map((track) => (
                <li key={track.id}>
                  <button type="button" onClick={() => onSelect(track.id)}>
                    <span className="preview-art" aria-hidden="true">♫</span>
                    <span className="truncate">{track.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="track-caption">No upcoming tracks.</p>}
        </div>
      </section>
    </aside>
  );
}
