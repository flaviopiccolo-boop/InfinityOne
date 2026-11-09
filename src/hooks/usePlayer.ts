import { useEffect, useRef, useState } from "react";
import { savePlaybackPosition } from "../lib/playbackPosition";
import type { PlaybackPosition } from "../lib/playbackPosition";
import type { TrackId, View } from "../types";

const stopped = { seconds: 0, duration: 0, playing: false };
/** A load of a track counts as a play after this much listening, or half of a shorter track. */
const playThresholdSeconds = 30;

type PlayerEvents = {
  /** Called once per load of a track, after it has played long enough to count. */
  onPlayed: (track: TrackId) => void;
};

/** The active track, its `<audio>` element, playback progress, volume, and saved position. */
export function usePlayer({ onPlayed }: PlayerEvents) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const counted = useRef<TrackId | undefined>(undefined);
  const lastPosition = useRef<PlaybackPosition | undefined>(undefined);
  const [active, setActive] = useState<TrackId>();
  const [resumeAt, setResumeAt] = useState<number>();
  const [playback, setPlayback] = useState(stopped);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [failedTrack, setFailedTrack] = useState<TrackId>();

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [active, muted, volume]);

  /** Loads a track and plays it from the start. */
  function selectTrack(track: TrackId) {
    if (track === active) return;
    counted.current = undefined;
    setPlayback(stopped);
    setFailedTrack(undefined);
    setResumeAt(undefined);
    setActive(track);
  }

  /** Loads a track paused at a saved position. */
  function resume(track: TrackId, seconds: number) {
    counted.current = undefined;
    setResumeAt(seconds);
    setActive(track);
  }

  /** Unloads the active track. */
  function stop() {
    setPlayback(stopped);
    setFailedTrack(undefined);
    setResumeAt(undefined);
    setActive(undefined);
  }

  function savePosition(audio: HTMLAudioElement, source: View | undefined, force = false) {
    if (!active || audio.readyState < 1 || audio.seeking) return;
    const position = {
      track: active,
      seconds: audio.ended ? 0 : audio.currentTime,
      source,
    };
    const previous = lastPosition.current;
    if (!force && previous?.track === position.track && previous.source === position.source
      && Math.floor(previous.seconds) === Math.floor(position.seconds)) return;

    savePlaybackPosition(position);
    lastPosition.current = position;
  }

  /** Counts a play of the active track once it has played long enough. */
  function countPlay(audio: HTMLAudioElement) {
    if (active === undefined || counted.current === active || audio.paused) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    if (audio.currentTime < Math.min(playThresholdSeconds, duration / 2)) return;
    counted.current = active;
    onPlayed(active);
  }

  function syncPlayback(audio: HTMLAudioElement) {
    const seconds = Math.round(audio.currentTime * 10) / 10;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const playing = !audio.paused && !audio.ended;
    setPlayback((current) => current.seconds === seconds && current.duration === duration && current.playing === playing
      ? current
      : { seconds, duration, playing });
  }

  function restorePosition(audio: HTMLAudioElement, source: View | undefined) {
    if (resumeAt && resumeAt < audio.duration) audio.currentTime = resumeAt;
    else savePosition(audio, source, true);
    syncPlayback(audio);
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = seconds;
      syncPlayback(audio);
    }
  }

  /** Plays or pauses the loaded track. Returns false when no track is loaded. */
  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return false;
    if (audio.paused) void audio.play().catch(() => setFailedTrack(active));
    else audio.pause();
    return true;
  }

  function changeVolume(value: number) {
    setVolume(value);
    setMuted(false);
  }

  return {
    audioRef,
    active,
    resumeAt,
    playback,
    volume,
    muted,
    failed: active !== undefined && failedTrack === active,
    selectTrack,
    resume,
    stop,
    savePosition,
    countPlay,
    syncPlayback,
    restorePosition,
    seek,
    togglePlayback,
    changeVolume,
    toggleMuted: () => setMuted(!muted),
    markFailed: () => setFailedTrack(active),
  };
}

export type Player = ReturnType<typeof usePlayer>;
