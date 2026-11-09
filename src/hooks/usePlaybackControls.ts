import { useEffect, useEffectEvent } from "react";
import type { RefObject } from "react";

function play(audio: HTMLAudioElement) {
  void audio.play().catch(() => {
    // The audio element reports playback errors through its error event.
  });
}

export function usePlaybackControls(
  audioRef: RefObject<HTMLAudioElement | null>,
  activeTrack: string | undefined,
  title: string | undefined,
  previousTrack: string | undefined,
  nextTrack: string | undefined,
  selectTrack: (path: string) => void,
) {
  const skipTo = useEffectEvent((path: string) => selectTrack(path));

  useEffect(() => {
    const audio = audioRef.current;
    const session = navigator.mediaSession;
    if (!activeTrack || !audio || !session) return;

    if (typeof MediaMetadata !== "undefined" && title) {
      session.metadata = new MediaMetadata({ title, artist: "Infinity One" });
    }
    const syncState = () => {
      session.playbackState = audio.paused || audio.ended ? "paused" : "playing";
    };
    const events = ["play", "pause", "ended", "error"];
    for (const event of events) audio.addEventListener(event, syncState);
    syncState();

    return () => {
      for (const event of events) audio.removeEventListener(event, syncState);
      session.metadata = null;
      session.playbackState = "none";
    };
  }, [activeTrack, audioRef, title]);

  useEffect(() => {
    if (!activeTrack) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (event.defaultPrevented || event.isComposing || !(target instanceof HTMLElement)
        || target.isContentEditable || target.closest("input, textarea, select")) return;

      const audio = audioRef.current;
      if (!audio || event.altKey || event.metaKey || event.shiftKey) return;

      if (event.code === "Space" && !event.ctrlKey && !target.closest("button, a, audio, [role=button]")) {
        event.preventDefault();
        if (event.repeat) return;
        if (audio.paused) play(audio);
        else audio.pause();
        return;
      }

      if (!event.ctrlKey) return;
      const track = event.key === "ArrowLeft" ? previousTrack : event.key === "ArrowRight" ? nextTrack : undefined;
      if (!track) return;
      event.preventDefault();
      if (!event.repeat) skipTo(track);
    }

    window.addEventListener("keydown", onKeyDown);
    const session = navigator.mediaSession;
    const registered: MediaSessionAction[] = [];
    if (session) {
      const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
        ["play", () => { if (audioRef.current) play(audioRef.current); }],
        ["pause", () => audioRef.current?.pause()],
        ["previoustrack", previousTrack ? () => skipTo(previousTrack) : null],
        ["nexttrack", nextTrack ? () => skipTo(nextTrack) : null],
      ];
      for (const [action, handler] of actions) {
        try {
          session.setActionHandler(action, handler);
          registered.push(action);
        } catch {
          // Some runtimes expose Media Session without supporting every action.
        }
      }
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      for (const action of registered) session?.setActionHandler(action, null);
    };
  }, [activeTrack, audioRef, previousTrack, nextTrack]);
}
