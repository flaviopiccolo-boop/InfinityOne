import type { TrackId, View } from "../types";

export type PlaybackPosition = {
  track: TrackId;
  seconds: number;
  source?: View;
};

const storageKey = "trackdock.playback-position.v2";
/** Positions saved before tracks had ids, identified by file path. */
const legacyStorageKey = "trackdock.playback-position.v1";

type StoredPosition = { track?: unknown; path?: unknown; seconds?: unknown; source?: unknown };

function read(key: string): StoredPosition | undefined {
  try {
    const value = localStorage.getItem(key);
    if (!value) return;
    const position: unknown = JSON.parse(value);
    return position && typeof position === "object" ? position : undefined;
  } catch {
    return undefined;
  }
}

/** Loads the saved position. `findTrack` resolves file paths saved by older versions. */
export function loadPlaybackPosition(findTrack: (path: string) => TrackId | undefined): PlaybackPosition | undefined {
  const stored = read(storageKey) ?? read(legacyStorageKey);
  if (!stored) return;
  const track = Number.isSafeInteger(stored.track) ? stored.track as TrackId
    : typeof stored.path === "string" ? findTrack(stored.path)
      : undefined;
  const { seconds, source } = stored;
  if (track === undefined || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return;
  return {
    track,
    seconds,
    source: typeof source === "string" || Number.isSafeInteger(source) ? source as View : undefined,
  };
}

export function savePlaybackPosition(position: PlaybackPosition) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(position));
    localStorage.removeItem(legacyStorageKey);
  } catch {
    // Playback remains available when local storage is unavailable.
  }
}
