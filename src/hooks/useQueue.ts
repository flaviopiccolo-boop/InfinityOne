import { useState } from "react";
import { shuffleTracks } from "../lib/tracks";
import type { Queue, RepeatMode, TrackId, View } from "../types";

/**
 * Manual changes to the queue on top of the collection order:
 * `tracks` is the explicit order, `priority` holds "Play next" tracks,
 * `tail` holds "Add to queue" tracks, and `excluded` holds removed tracks.
 */
type QueueOrder = { tracks: TrackId[]; priority: TrackId[]; tail: TrackId[]; excluded: TrackId[] };

const emptyQueueOrder: QueueOrder = { tracks: [], priority: [], tail: [], excluded: [] };
const nextRepeatMode: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

type QueueOptions = {
  /** Library tracks, used as the queue when no playlist or Favorites is the source. */
  tracks: TrackId[];
  active: TrackId | undefined;
  selectTrack: (id: TrackId) => void;
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
  for (const id of queueOrder.excluded) eligibleTracks.delete(id);
  if (active) eligibleTracks.add(active);
  const queuedTracks = [...new Set([...queueOrder.tracks, ...collectionTracks])]
    .filter((id) => eligibleTracks.has(id));
  const activeIndex = active ? queuedTracks.indexOf(active) : -1;
  const previousTrack = activeIndex > 0 ? queuedTracks[activeIndex - 1] : undefined;
  const upcomingTracks = activeIndex >= 0 ? queuedTracks.slice(activeIndex + 1) : [];
  const nextTrack = upcomingTracks[0] ?? (repeat === "all" && activeIndex > 0 ? queuedTracks[0] : undefined);
  const loop = repeat === "one" || (repeat === "all" && queuedTracks.length === 1);

  /** Starts a new queue from `source`, or from the library when there is no source. */
  function startTrack(id: TrackId, source?: Queue, libraryTracks = tracks) {
    if (id === active && source?.id === queue?.id) return;
    const ids = source?.tracks ?? libraryTracks;
    setQueue(source);
    setOrder(shuffle
      ? { ...emptyQueueOrder, tracks: [id, ...shuffleTracks(ids.filter((track) => track !== id))] }
      : undefined);
    selectTrack(id);
  }

  /** Updates the source collection's tracks when `id` is the current queue source. */
  function updateSource(id: View, update: (ids: TrackId[]) => TrackId[]) {
    setQueue((current) => current?.id === id ? { ...current, tracks: update(current.tracks) } : current);
  }

  function toggleShuffle() {
    setShuffle(!shuffle);
    if (activeIndex < 0) return;
    const priority = new Set(queueOrder.priority);
    const tail = new Set(queueOrder.tail);
    const pinned = upcomingTracks.filter((id) => priority.has(id));
    const appended = upcomingTracks.filter((id) => tail.has(id));
    const ordinary = upcomingTracks.filter((id) => !priority.has(id) && !tail.has(id));
    const remaining = new Set(ordinary);
    const ordered = shuffle
      ? collectionTracks.filter((id) => remaining.has(id))
      : shuffleTracks(ordinary);
    setOrder({
      ...queueOrder,
      tracks: [...queuedTracks.slice(0, activeIndex + 1), ...pinned, ...ordered, ...appended],
    });
  }

  /**
   * Plays `id` next or at the end of the queue. Without an active track it starts
   * playback from `source` instead. Returns true when the track was added to the queue.
   */
  function scheduleTrack(id: TrackId, placement: "next" | "end", source?: Queue) {
    if (!active) {
      startTrack(id, source);
      return false;
    }
    if (id === active) return false;

    const remaining = queuedTracks.filter((track) => track !== id);
    const insertAt = placement === "next" ? remaining.indexOf(active) + 1 : remaining.length;
    remaining.splice(insertAt, 0, id);
    const priority = queueOrder.priority.filter((track) => track !== id);
    const tail = queueOrder.tail.filter((track) => track !== id);
    if (placement === "next") priority.unshift(id);
    else tail.push(id);

    setOrder({
      tracks: remaining,
      priority,
      tail,
      excluded: queueOrder.excluded.filter((track) => track !== id),
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

  function removeUpcoming(id: TrackId) {
    setOrder({
      tracks: queuedTracks.filter((track) => track !== id),
      priority: queueOrder.priority.filter((track) => track !== id),
      tail: queueOrder.tail.filter((track) => track !== id),
      excluded: [...queueOrder.excluded, id],
    });
  }

  /** Drops a track that left the library from the queue and its source collection. */
  function forget(id: TrackId) {
    const keep = (track: TrackId) => track !== id;
    setQueue((current) => current && { ...current, tracks: current.tracks.filter(keep) });
    setOrder((current) => current && {
      tracks: current.tracks.filter(keep),
      priority: current.priority.filter(keep),
      tail: current.tail.filter(keep),
      excluded: current.excluded.filter(keep),
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
    forget,
    playNext,
  };
}

export type PlaybackQueue = ReturnType<typeof useQueue>;
