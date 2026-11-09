import type { CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import QueuePanel from "./QueuePanel";
import { formatDuration } from "../hooks/useTrackMetadata";
import type { Player } from "../hooks/usePlayer";
import type { PlaybackQueue } from "../hooks/useQueue";
import type { Track, TrackId } from "../types";

type PlayerBarProps = {
  player: Player;
  queue: PlaybackQueue;
  /** The loaded track. */
  track: Track | undefined;
  title: (track: TrackId) => string;
  name: (track: TrackId) => string;
  artist: string | null | undefined;
  cover: string | undefined;
  onCoverError: () => void;
  /** Whether Play can start the open collection when no track is loaded. */
  canStart: boolean;
  onTogglePlayback: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
};

function rangeProgress(percent: number) {
  return { "--range-progress": `${percent}%` } as CSSProperties;
}

export default function PlayerBar({
  player, queue, track, title, name, artist, cover, onCoverError, canStart, onTogglePlayback, queueOpen, onToggleQueue,
}: PlayerBarProps) {
  const { active, playback, volume, muted } = player;
  const { previousTrack, nextTrack, shuffle, repeat } = queue;
  const source = queue.source;

  return (
    <footer className="player" aria-label="Player">
      <div className="player-track">
        <div className="track-art" aria-hidden="true">
          {cover ? <img src={cover} alt="" onError={onCoverError} /> : "♫"}
        </div>
        <div className="track-details">
          <div className="eyebrow">Now playing</div>
          <p className="truncate" title={track?.location}>{active ? title(active) : "No track selected"}</p>
          {artist && <div className="track-caption truncate">{artist}</div>}
        </div>
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <button className="player-icon" type="button" aria-label="Shuffle" aria-pressed={shuffle}
            title={shuffle ? "Shuffle on" : "Shuffle off"} onClick={queue.toggleShuffle}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h3c3 0 5 4 6 6s3 6 6 6h3m-3-3 3 3-3 3M3 18h3c1.4 0 2.6-.9 3.6-2.1m4.8-7.8C15.4 6.9 16.6 6 18 6h3m-3-3 3 3-3 3" />
            </svg>
          </button>
          <button className="player-icon skip-track" type="button" aria-label="Previous track" aria-keyshortcuts="Control+ArrowLeft" title="Previous track (Ctrl+Left)"
            disabled={!previousTrack} onClick={() => {
              if (previousTrack) player.selectTrack(previousTrack);
            }}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h2v12H5zm10 0L7 10l8 6z" /></svg>
          </button>
          <button className="play-button" type="button" aria-label={playback.playing ? "Pause" : "Play"}
            title={playback.playing ? "Pause" : "Play"}
            disabled={!active && !canStart} onClick={onTogglePlayback}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {playback.playing ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="M8 4v16l13-8z" />}
            </svg>
          </button>
          <button className="player-icon skip-track" type="button" aria-label="Next track" aria-keyshortcuts="Control+ArrowRight" title="Next track (Ctrl+Right)"
            disabled={!nextTrack} onClick={queue.playNext}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4h2v12h-2zM5 4l8 6-8 6z" /></svg>
          </button>
          <button className="player-icon" type="button" data-active={repeat !== "off"}
            aria-label={`Repeat: ${repeat}`} title={`Repeat: ${repeat}`} onClick={queue.cycleRepeat}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m17 3 4 4-4 4m4-4H7a4 4 0 0 0-4 4m4 10-4-4 4-4m-4 4h14a4 4 0 0 0 4-4" />
              {repeat === "one" && <path d="m10.5 11 1.5-1v4" />}
            </svg>
          </button>
        </div>
        <div className="seek-controls">
          <span>{formatDuration(playback.seconds)}</span>
          <input type="range" aria-label="Playback position" min={0} max={playback.duration || 1}
            value={Math.min(playback.seconds, playback.duration)} step={0.1} disabled={!playback.duration}
            style={rangeProgress(playback.duration ? Math.min(100, playback.seconds / playback.duration * 100) : 0)}
            onChange={(event) => player.seek(event.target.valueAsNumber)} />
          <span>{formatDuration(playback.duration)}</span>
        </div>
        {track && (
          <audio key={track.id} ref={player.audioRef} src={convertFileSrc(track.location)} hidden
            autoPlay={player.resumeAt === undefined} loop={queue.loop}
            onLoadedMetadata={(event) => player.restorePosition(event.currentTarget, source)}
            onDurationChange={(event) => player.syncPlayback(event.currentTarget)}
            onPlay={(event) => player.syncPlayback(event.currentTarget)}
            onTimeUpdate={(event) => {
              player.syncPlayback(event.currentTarget);
              player.savePosition(event.currentTarget, source);
              player.countPlay(event.currentTarget);
            }}
            onPause={(event) => {
              player.syncPlayback(event.currentTarget);
              player.savePosition(event.currentTarget, source, true);
            }}
            onSeeked={(event) => {
              player.syncPlayback(event.currentTarget);
              player.savePosition(event.currentTarget, source, true);
            }}
            onEnded={(event) => {
              player.syncPlayback(event.currentTarget);
              player.savePosition(event.currentTarget, source, true);
              queue.playNext();
            }}
            onError={(event) => {
              player.syncPlayback(event.currentTarget);
              player.markFailed();
            }} />
        )}
      </div>
      <div className="playback-options">
        <button className="player-icon" type="button" aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"} onClick={player.toggleMuted}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9h4l5-4v14l-5-4H3z"/>
            {muted ? <path d="m16 9 5 6m0-6-5 6"/> : <path d="M16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>}
          </svg>
        </button>
        <input className="volume-slider" type="range" aria-label="Volume" min={0} max={1} step={0.01}
          value={muted ? 0 : volume} style={rangeProgress(muted ? 0 : volume * 100)}
          onChange={(event) => player.changeVolume(event.target.valueAsNumber)} />
        <button className="player-icon queue-toggle" type="button" aria-label="Queue" title="Queue"
          aria-expanded={queueOpen} aria-controls="playback-queue" onClick={onToggleQueue}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 11h16M4 16h8m4-1 5 3-5 3z" />
          </svg>
        </button>
      </div>
      <QueuePanel open={queueOpen} active={active} queue={queue} title={title} name={name} onSelect={player.selectTrack} />
      {player.failed && <p className="error" role="alert">Check that the file is still in its original folder.</p>}
    </footer>
  );
}
