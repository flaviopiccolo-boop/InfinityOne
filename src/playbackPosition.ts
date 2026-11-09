export type PlaybackPosition = {
  path: string;
  seconds: number;
  source?: number | "favorites";
};

const storageKey = "trackdock.playback-position.v1";

export function loadPlaybackPosition(): PlaybackPosition | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    if (!value) return;
    const position: Partial<PlaybackPosition> | null = JSON.parse(value);
    if (!position || typeof position.path !== "string"
      || typeof position.seconds !== "number" || !Number.isFinite(position.seconds)
      || position.seconds < 0) return;
    const source = position.source;
    return {
      path: position.path,
      seconds: position.seconds,
      source: source === "favorites" || Number.isSafeInteger(source) ? source : undefined,
    };
  } catch {
    return undefined;
  }
}

export function savePlaybackPosition(position: PlaybackPosition) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(position));
  } catch {
    // Playback remains available when local storage is unavailable.
  }
}
