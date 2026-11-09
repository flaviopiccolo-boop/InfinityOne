import type { PlaybackQueue } from "../hooks/useQueue";
import type { TrackId } from "../types";

type QueuePanelProps = {
  open: boolean;
  active: TrackId | undefined;
  queue: PlaybackQueue;
  title: (track: TrackId) => string;
  /** The file name, used to label the row's buttons. */
  name: (track: TrackId) => string;
  onSelect: (track: TrackId) => void;
};

export default function QueuePanel({ open, active, queue, title, name, onSelect }: QueuePanelProps) {
  const upcoming = queue.upcomingTracks;
  return (
    <section id="playback-queue" className="queue-panel" aria-labelledby="queue-title" hidden={!open}>
      <h2 id="queue-title">Up next</h2>
      {upcoming.length > 0 ? (
        <ol>
          {upcoming.map((track, index) => (
            <li key={track}>
              <div className="queue-row">
                <button className="queue-track truncate" type="button" title={title(track)}
                  onClick={() => onSelect(track)}>{title(track)}</button>
                <button className="secondary queue-action" type="button" disabled={index === 0}
                  aria-label={`Move ${name(track)} up`} title="Move up"
                  onClick={() => queue.moveUpcoming(index, -1)}>↑</button>
                <button className="secondary queue-action" type="button" disabled={index === upcoming.length - 1}
                  aria-label={`Move ${name(track)} down`} title="Move down"
                  onClick={() => queue.moveUpcoming(index, 1)}>↓</button>
                <button className="secondary queue-action" type="button"
                  aria-label={`Remove ${name(track)} from queue`} title="Remove from queue"
                  onClick={() => queue.removeUpcoming(track)}>×</button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p>{active ? "No upcoming tracks." : "Play a track to start the queue."}</p>
      )}
    </section>
  );
}
