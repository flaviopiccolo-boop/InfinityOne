import { useState } from "react";
import { shuffleTracks } from "../lib/tracks";
import type { Queue, RepeatMode, View } from "../types";

/**
 * Manual changes to the queue on top of the collection order:
 * `tracks` is the explicit order, `priority` holds "Play next" tracks,
 * `tail` holds "Add to queue" tracks, and `excluded` holds removed tracks.
 */
type QueueOrder = { tracks: string[]; priority: string[]; tail: string[]; excluded: string[] };

const emptyQueueOrder: QueueOrder = { tracks: [], priority: [], tail: [], excluded: [] };
const nextRepeatMode: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

type QueueOptions = {
  /** Library tracks, used as the queue when no playlist or Favorites is the source. */
  tracks: string[];
  active: string | undefined;
  selectTrack: (path: string) => void;
};

/** The playback queue: its source collection, manual order, shuffle, and repeat. */
export function useQueue({ tracks, active, selectTrack }: QueueOptions) {
  const [queue, setQueue] = useState<Queue>();
  const [order, setOrder] = useState<QueueOrder>();
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");

  const collectionTracks = queue?.tracks ?? tracks;
  const queueOrder = order ?? emptyQueueOrder;
  const eligibleTracks = new Set([...collectionTracks, ...queueOrder.priority, ...queueOrder.tail]);
  for (const path of queueOrder.excluded) eligibleTracks.delete(path);
  if (active) eligibleTracks.add(active);
  const queuedTracks = [...new Set([...queueOrder.tracks, ...collectionTracks])]
    .filter((path) => eligibleTracks.has(path));
  const activeIndex = active ? queuedTracks.indexOf(active) : -1;
  const previousTrack = activeIndex > 0 ? queuedTracks[activeIndex - 1] : undefined;
  const upcomingTracks = activeIndex >= 0 ? queuedTracks.slice(activeIndex + 1) : [];
  const nextTrack = upcomingTracks[0] ?? (repeat === "all" && activeIndex > 0 ? queuedTracks[0] : undefined);
  const loop = repeat === "one" || (repeat === "all" && queuedTracks.length === 1);

  /** Starts a new queue from `source`, or from the library when there is no source. */
  function startTrack(path: string, source?: Queue, libraryTracks = tracks) {
    if (path === active && source?.id === queue?.id) return;
    const paths = source?.tracks ?? libraryTracks;
    setQueue(source);
    setOrder(shuffle
      ? { ...emptyQueueOrder, tracks: [path, ...shuffleTracks(paths.filter((track) => track !== path))] }
      : undefined);
    selectTrack(path);
  }

  /** Updates the source collection's tracks when `id` is the current queue source. */
  function updateSource(id: View, update: (paths: string[]) => string[]) {
    setQueue((current) => current?.id === id ? { ...current, tracks: update(current.tracks) } : current);
  }

  function toggleShuffle() {
    setShuffle(!shuffle);
    if (activeIndex < 0) return;
    const priority = new Set(queueOrder.priority);
    const tail = new Set(queueOrder.tail);
    const pinned = upcomingTracks.filter((path) => priority.has(path));
    const appended = upcomingTracks.filter((path) => tail.has(path));
    const ordinary = upcomingTracks.filter((path) => !priority.has(path) && !tail.has(path));
    const remaining = new Set(ordinary);
    const ordered = shuffle
      ? collectionTracks.filter((path) => remaining.has(path))
      : shuffleTracks(ordinary);
    setOrder({
      ...queueOrder,
      tracks: [...queuedTracks.slice(0, activeIndex + 1), ...pinned, ...ordered, ...appended],
    });
  }

  /**
   * Plays `path` next or at the end of the queue. Without an active track it starts
   * playback from `source` instead. Returns true when the track was added to the queue.
   */
  function scheduleTrack(path: string, placement: "next" | "end", source?: Queue) {
    if (!active) {
      startTrack(path, source);
      return false;
    }
    if (path === active) return false;

    const remaining = queuedTracks.filter((track) => track !== path);
    const insertAt = placement === "next" ? remaining.indexOf(active) + 1 : remaining.length;
    remaining.splice(insertAt, 0, path);
    const priority = queueOrder.priority.filter((track) => track !== path);
    const tail = queueOrder.tail.filter((track) => track !== path);
    if (placement === "next") priority.unshift(path);
    else tail.push(path);

    setOrder({
      tracks: remaining,
      priority,
      tail,
      excluded: queueOrder.excluded.filter((track) => track !== path),
    });
    return true;
  }

  function moveUpcoming(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= upcomingTracks.length) return;
    const first = activeIndex + 1 + index;
    const second = first + direction;
    const reordered = [...queuedTracks];
    [reordered[first], reordered[second]] = [reordered[second], reordered[first]];
    setOrder({ ...queueOrder, tracks: reordered });
  }

  function removeUpcoming(path: string) {
    setOrder({
      tracks: queuedTracks.filter((track) => track !== path),
      priority: queueOrder.priority.filter((track) => track !== path),
      tail: queueOrder.tail.filter((track) => track !== path),
      excluded: [...queueOrder.excluded, path],
    });
  }

  function playNext() {
    if (nextTrack) selectTrack(nextTrack);
  }

  return {
    source: queue?.id,
    shuffle,
    repeat,
    loop,
    previousTrack,
    nextTrack,
    upcomingTracks,
    setSource: setQueue,
    startTrack,
    updateSource,
    toggleShuffle,
    cycleRepeat: () => setRepeat((mode) => nextRepeatMode[mode]),
    scheduleTrack,
    moveUpcoming,
    removeUpcoming,
    playNext,
  };
}

export type PlaybackQueue = ReturnType<typeof useQueue>;
