import type { Track } from "../types";

/** The file name of a track, or its location for sources without files. */
export function trackName(track: Track) {
  return track.location.split(/[\\/]/).pop() ?? track.location;
}

/** The embedded title tag, or the file name when the track has none. */
export function trackTitle(track: Track, tags?: { title: string | null }) {
  return tags?.title ?? trackName(track);
}

export function trackFormat(track: Track) {
  return track.location.split(".").pop()?.toUpperCase();
}

export function shuffleTracks<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function withTrack<T>(items: T[], item: T) {
  return [...new Set([...items, item])];
}

export function withoutTrack<T>(items: T[], item: T) {
  return items.filter((entry) => entry !== item);
}
