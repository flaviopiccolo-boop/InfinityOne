import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Track, TrackId } from "../types";

export type TrackMetadata = {
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  /** Often holds the prompt or style description for generated music. */
  comment: string | null;
  lyrics: string | null;
  /** The music generator that made the file, when its tags say so. */
  generator: { name: string; url: string | null } | null;
  durationSeconds: number;
};

export function useTrackMetadata(tracks: Track[], active: TrackId | undefined) {
  const [metadata, setMetadata] = useState<Record<TrackId, TrackMetadata>>({});
  const [artwork, setArtwork] = useState<{ track: TrackId; src: string }>();
  const scanned = useRef(new Set<TrackId>());

  useEffect(() => {
    let cancelled = false;
    const pending = tracks.filter((track) => !track.missing && !scanned.current.has(track.id))
      .map((track) => track.id);

    async function readTags() {
      const batchSize = 64;
      for (let index = 0; index < pending.length && !cancelled; index += batchSize) {
        const trackIds = pending.slice(index, index + batchSize);
        const result = await invoke<Record<TrackId, TrackMetadata>>("read_track_metadata", { trackIds });
        if (cancelled) return;
        for (const id of trackIds) scanned.current.add(id);
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
    invoke<string | null>("read_track_artwork", { trackId: active })
      .then((src) => {
        if (!cancelled) setArtwork(src ? { track: active, src } : undefined);
      })
      .catch(() => {
        if (!cancelled) setArtwork(undefined);
      });
    return () => { cancelled = true; };
  }, [active]);

  return {
    metadata,
    cover: artwork?.track === active ? artwork?.src : undefined,
    clearCover: () => setArtwork(undefined),
  };
}

export function formatDuration(seconds: number) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
