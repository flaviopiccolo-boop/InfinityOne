import { trackName } from "../lib/tracks";
import type { PlaybackQueue } from "../hooks/useQueue";

type QueuePanelProps = {
  open: boolean;
  active: string | undefined;
  queue: PlaybackQueue;
  title: (path: string) => string;
  onSelect: (path: string) => void;
};

export default function QueuePanel({ open, active, queue, title, onSelect }: QueuePanelProps) {
  const upcoming = queue.upcomingTracks;
  return (
    <section id="playback-queue" className="queue-panel" aria-labelledby="queue-title" hidden={!open}>
      <h2 id="queue-title">Up next</h2>
      {upcoming.length > 0 ? (
        <ol>
          {upcoming.map((path, index) => (
            <li key={path}>
              <div className="queue-row">
                <button className="queue-track truncate" type="button" title={title(path)}
                  onClick={() => onSelect(path)}>{title(path)}</button>
                <button className="secondary queue-action" type="button" disabled={index === 0}
                  aria-label={`Move ${trackName(path)} up`} title="Move up"
                  onClick={() => queue.moveUpcoming(index, -1)}>↑</button>
                <button className="secondary queue-action" type="button" disabled={index === upcoming.length - 1}
                  aria-label={`Move ${trackName(path)} down`} title="Move down"
                  onClick={() => queue.moveUpcoming(index, 1)}>↓</button>
                <button className="secondary queue-action" type="button"
                  aria-label={`Remove ${trackName(path)} from queue`} title="Remove from queue"
                  onClick={() => queue.removeUpcoming(path)}>×</button>
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
