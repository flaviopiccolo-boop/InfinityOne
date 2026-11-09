import { useEffect, useEffectEvent, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withoutTrack, withTrack } from "../lib/tracks";
import type { ImportedArchive, Playlist, SavedLibrary } from "../types";

type LibraryEvents = {
  onLoaded: (saved: SavedLibrary) => void;
  onLoadError: () => void;
};

/**
 * Tracks, playlists, and favorites saved in the local SQLite library.
 * Each operation saves through the backend before updating local state and throws on failure.
 */
export function useLibrary({ onLoaded, onLoadError }: LibraryEvents) {
  const [tracks, setTracks] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loaded = useEffectEvent(onLoaded);
  const failed = useEffectEvent(onLoadError);

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

  async function saveTracks(paths: string[]) {
    await invoke("save_tracks", { paths });
    setTracks((current) => [...new Set([...current, ...paths])]);
  }

  async function importArchive(path: string) {
    const imported = await invoke<ImportedArchive>("import_archive", { path });
    setTracks((current) => [...new Set([...current, ...imported.paths])]);
    return imported;
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

  async function setPlaylistTrack(playlistId: number, path: string, included: boolean) {
    await invoke(included ? "add_playlist_track" : "remove_playlist_track", { playlistId, path });
    setPlaylists((current) => current.map((item) => item.id === playlistId
      ? { ...item, tracks: included ? withTrack(item.tracks, path) : withoutTrack(item.tracks, path) }
      : item,
    ));
  }

  async function setFavorite(path: string, favorite: boolean) {
    await invoke("set_favorite", { path, favorite });
    setFavorites((current) => favorite ? withTrack(current, path) : withoutTrack(current, path));
  }

  return {
    tracks,
    playlists,
    favorites,
    loading,
    saveTracks,
    importArchive,
    createPlaylist,
    renamePlaylist,
    setPlaylistTrack,
    setFavorite,
  };
}
