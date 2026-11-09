import { useEffect, useEffectEvent, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { withoutTrack, withTrack } from "../lib/tracks";
import type { ImportedArchive, Playlist, SavedLibrary, Track, TrackId, WatchedFolder } from "../types";

type LibraryEvents = {
  onLoaded: (saved: SavedLibrary) => void;
  onLoadError: () => void;
  /** Called when tracks arrive from a watched folder. */
  onTracksAdded: (tracks: Track[]) => void;
};

function mergeTracks(current: Track[], added: Track[]) {
  const known = new Set(current.map((track) => track.id));
  return [...current, ...added.filter((track) => !known.has(track.id))];
}

/**
 * Tracks, playlists, and favorites saved in the local SQLite library.
 * Each operation saves through the backend before updating local state and throws on failure.
 */
export function useLibrary({ onLoaded, onLoadError, onTracksAdded }: LibraryEvents) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<TrackId[]>([]);
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([]);
  const [loading, setLoading] = useState(true);

  const loaded = useEffectEvent(onLoaded);
  const failed = useEffectEvent(onLoadError);
  const arrived = useEffectEvent(onTracksAdded);

  useEffect(() => {
    let cancelled = false;
    invoke<WatchedFolder[]>("list_watched_folders")
      .then((folders) => {
        if (!cancelled) setWatchedFolders(folders);
      })
      .catch(() => {
        // Watched folders keep working in the backend; the list is only for display.
      });
    const unlisten = listen<Track[]>("tracks-added", ({ payload }) => {
      setTracks((current) => mergeTracks(current, payload));
      arrived(payload);
    });
    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<SavedLibrary>("load_library")
      .then((saved) => {
        if (cancelled) return;
        setTracks(saved.tracks);
        setPlaylists(saved.playlists);
        setFavorites(saved.favorites);
        loaded(saved);
      })
      .catch(() => {
        if (!cancelled) failed();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Adds local files and returns their tracks, including ones already in the library. */
  async function saveTracks(paths: string[]) {
    const saved = await invoke<Track[]>("save_tracks", { paths });
    setTracks((current) => mergeTracks(current, saved));
    return saved;
  }

  async function importArchive(path: string) {
    const imported = await invoke<ImportedArchive>("import_archive", { path });
    setTracks((current) => mergeTracks(current, imported.tracks));
    return imported;
  }

  /** Watches a folder; files already in it are imported in the background. */
  async function addWatchedFolder(path: string) {
    const folder = await invoke<WatchedFolder>("add_watched_folder", { path });
    setWatchedFolders((current) => current.some((item) => item.id === folder.id) ? current : [...current, folder]);
  }

  async function removeWatchedFolder(folderId: number) {
    await invoke("remove_watched_folder", { folderId });
    setWatchedFolders((current) => current.filter((item) => item.id !== folderId));
  }

  /** Removes a track from the library, its playlists, and Favorites. */
  async function removeTrack(trackId: TrackId) {
    await invoke("remove_track", { trackId });
    setTracks((current) => current.filter((track) => track.id !== trackId));
    setFavorites((current) => withoutTrack(current, trackId));
    setPlaylists((current) => current.map((item) => ({ ...item, tracks: withoutTrack(item.tracks, trackId) })));
  }

  function updateTrack(trackId: TrackId, changes: Partial<Track>) {
    setTracks((current) => current.map((track) => track.id === trackId ? { ...track, ...changes } : track));
  }

  /** Sets 1 to 5 stars, or clears the rating with null. */
  async function setRating(trackId: TrackId, rating: number | null) {
    await invoke("set_rating", { trackId, rating });
    updateTrack(trackId, { rating });
  }

  async function recordPlay(trackId: TrackId) {
    const stats = await invoke<Pick<Track, "playCount" | "lastPlayedAt">>("record_play", { trackId });
    updateTrack(trackId, stats);
  }

  async function createPlaylist(name: string) {
    const created = await invoke<Playlist>("create_playlist", { name });
    setPlaylists((current) => [...current, created]);
    return created;
  }

  async function renamePlaylist(playlistId: number, name: string) {
    await invoke("rename_playlist", { playlistId, name });
    setPlaylists((current) => current.map((item) =>
      item.id === playlistId ? { ...item, name } : item,
    ));
  }

  async function deletePlaylist(playlistId: number) {
    await invoke("delete_playlist", { playlistId });
    setPlaylists((current) => current.filter((item) => item.id !== playlistId));
  }

  async function setPlaylistTrack(playlistId: number, trackId: TrackId, included: boolean) {
    await invoke(included ? "add_playlist_track" : "remove_playlist_track", { playlistId, trackId });
    setPlaylists((current) => current.map((item) => item.id === playlistId
      ? { ...item, tracks: included ? withTrack(item.tracks, trackId) : withoutTrack(item.tracks, trackId) }
      : item,
    ));
  }

  async function setFavorite(trackId: TrackId, favorite: boolean) {
    await invoke("set_favorite", { trackId, favorite });
    setFavorites((current) => favorite ? withTrack(current, trackId) : withoutTrack(current, trackId));
  }

  return {
    tracks,
    playlists,
    favorites,
    watchedFolders,
    loading,
    saveTracks,
    addWatchedFolder,
    removeWatchedFolder,
    importArchive,
    removeTrack,
    setRating,
    recordPlay,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    setPlaylistTrack,
    setFavorite,
  };
}
