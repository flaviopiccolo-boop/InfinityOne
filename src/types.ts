export type Playlist = { id: number; name: string; tracks: string[] };
export type SavedLibrary = { tracks: string[]; playlists: Playlist[]; favorites: string[] };
/** A collection shown in the workspace: a playlist id or Favorites. `undefined` is the library. */
export type View = number | "favorites";
export type Queue = { id: View; tracks: string[] };
export type RepeatMode = "off" | "all" | "one";
export type ImportedArchive = { paths: string[]; added: number };
