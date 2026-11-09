export type TrackId = number;
/**
 * A library entry. `source` says where the audio lives and `location` how to find it there:
 * a file path for "local". Other sources, such as music services, can be added later.
 */
export type Track = { id: TrackId; source: string; location: string; missing: boolean };
export type Playlist = { id: number; name: string; tracks: TrackId[] };
export type SavedLibrary = { tracks: Track[]; playlists: Playlist[]; favorites: TrackId[] };
/** A collection shown in the workspace: a playlist id or Favorites. `undefined` is the library. */
export type View = number | "favorites";
export type Queue = { id: View; tracks: TrackId[] };
export type RepeatMode = "off" | "all" | "one";
export type ImportedArchive = { tracks: Track[]; added: number };
