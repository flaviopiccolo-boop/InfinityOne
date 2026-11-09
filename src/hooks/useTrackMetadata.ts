import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type TrackMetadata = {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSeconds: number;
};

export function useTrackMetadata(tracks: string[], active: string | undefined) {
  const [metadata, setMetadata] = useState<Record<string, TrackMetadata>>({});
  const [artwork, setArtwork] = useState<{ path: string; src: string }>();
  const scanned = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const pending = tracks.filter((path) => !scanned.current.has(path));

    async function readTags() {
      const batchSize = 64;
      for (let index = 0; index < pending.length && !cancelled; index += batchSize) {
        const paths = pending.slice(index, index + batchSize);
        const result = await invoke<Record<string, TrackMetadata>>("read_track_metadata", { paths });
        if (cancelled) return;
        for (const path of paths) scanned.current.add(path);
        setMetadata((current) => ({ ...current, ...result }));
      }
    }

    void readTags().catch(() => {
      // Keep filename-based display when metadata cannot be read.
    });
    return () => { cancelled = true; };
  }, [tracks]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    invoke<string | null>("read_track_artwork", { path: active })
      .then((src) => {
        if (!cancelled) setArtwork(src ? { path: active, src } : undefined);
      })
      .catch(() => {
        if (!cancelled) setArtwork(undefined);
      });
    return () => { cancelled = true; };
  }, [active]);

  return {
    metadata,
    cover: artwork?.path === active ? artwork?.src : undefined,
    clearCover: () => setArtwork(undefined),
  };
}

export function formatDuration(seconds: number) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
