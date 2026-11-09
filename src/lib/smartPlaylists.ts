import type { SmartView, Track } from "../types";

type SmartPlaylist = {
  id: SmartView;
  name: string;
  description: string;
  /** Shown when no track matches. */
  empty: string;
  select: (tracks: Track[], now: number) => Track[];
};

const recentSeconds = 7 * 24 * 60 * 60;
const mostPlayedLimit = 50;

/** Collections built from ratings, play counts, and import dates. Order within each is meaningful. */
export const smartPlaylists: SmartPlaylist[] = [
  {
    id: "unrated",
    name: "Unrated",
    description: "Tracks without a rating. Press 1–5 while one plays to rate it.",
    empty: "Every track has a rating.",
    select: (tracks) => tracks.filter((track) => track.rating === null),
  },
  {
    id: "top-rated",
    name: "Top rated",
    description: "Tracks with 4 or 5 stars, best first.",
    empty: "Rate tracks 4 or 5 stars to see them here.",
    select: (tracks) => tracks.filter((track) => (track.rating ?? 0) >= 4)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
  },
  {
    id: "recent",
    name: "Recently added",
    description: "Tracks added in the last 7 days, newest first.",
    empty: "Tracks you add in the next 7 days appear here.",
    select: (tracks, now) => tracks.filter((track) => track.addedAt >= now - recentSeconds)
      .sort((a, b) => b.addedAt - a.addedAt),
  },
  {
    id: "most-played",
    name: "Most played",
    description: `Your ${mostPlayedLimit} most played tracks.`,
    empty: "Tracks appear here after you play them.",
    select: (tracks) => tracks.filter((track) => track.playCount > 0)
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, mostPlayedLimit),
  },
  {
    id: "never-played",
    name: "Never played",
    description: "Tracks you have not listened to yet.",
    empty: "You have played every track.",
    select: (tracks) => tracks.filter((track) => track.playCount === 0),
  },
];

export function findSmartPlaylist(view: unknown) {
  return smartPlaylists.find((item) => item.id === view);
}

export function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}
