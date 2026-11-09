import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { loadPlaybackPosition, savePlaybackPosition } from "./playbackPosition";
import type { PlaybackPosition } from "./playbackPosition";
import { usePlaybackControls } from "./usePlaybackControls";
import { formatDuration, useTrackMetadata } from "./useTrackMetadata";
import TitleBar from "./TitleBar";
import "./App.css";

type Playlist = { id: number; name: string; tracks: string[] };
type Library = { tracks: string[]; playlists: Playlist[]; favorites: string[] };
type View = number | "favorites";
type Queue = { id: View; tracks: string[] };
type QueueOrder = { tracks: string[]; priority: string[]; tail: string[]; excluded: string[] };
type RepeatMode = "off" | "all" | "one";

const emptyQueueOrder: QueueOrder = { tracks: [], priority: [], tail: [], excluded: [] };
const nextRepeatMode: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
type ImportedArchive = { paths: string[]; added: number };

function trackName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function shuffleTracks(paths: string[]) {
  const shuffled = [...paths];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export default function App() {
  const [tracks, setTracks] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [view, setView] = useState<View>();
  const [queue, setQueue] = useState<Queue>();
  const [order, setOrder] = useState<QueueOrder>();
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [active, setActive] = useState<string>();
  const [resumeAt, setResumeAt] = useState<number>();
  const lastPosition = useRef<PlaybackPosition | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playback, setPlayback] = useState({ seconds: 0, duration: 0, playing: false });
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [failedTrack, setFailedTrack] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importingArchive, setImportingArchive] = useState(false);
  const [editor, setEditor] = useState<number | "new">();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [candidate, setCandidate] = useState("");

  const { metadata, cover, clearCover } = useTrackMetadata(tracks, active);
  const activeMetadata = active ? metadata[active] : undefined;

  function displayTitle(path: string) {
    return metadata[path]?.title ?? trackName(path);
  }

  const playlist = playlists.find((item) => item.id === view);
  const showingFavorites = view === "favorites";
  const favoritePaths = new Set(favorites);
  const visibleTracks = showingFavorites ? favorites : playlist?.tracks ?? tracks;
  const query = search.trim().toLocaleLowerCase();
  const matches = visibleTracks
    .map((path, index) => ({ path, position: index + 1 }))
    .filter(({ path }) => [trackName(path), metadata[path]?.title, metadata[path]?.artist, metadata[path]?.album]
      .some((value) => value?.toLocaleLowerCase().includes(query)));
  const displayedCount = query ? matches.length : visibleTracks.length;
  const collectionTracks = queue?.tracks ?? tracks;
  const sourceQueue = showingFavorites ? { id: "favorites" as const, tracks: favorites } : playlist;
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
  const availableTracks = playlist ? tracks.filter((path) => !playlist.tracks.includes(path)) : [];

  useEffect(() => {
    let cancelled = false;
    invoke<Library>("load_library")
      .then((saved) => {
        if (cancelled) return;
        setTracks(saved.tracks);
        setPlaylists(saved.playlists);
        setFavorites(saved.favorites);
        const position = loadPlaybackPosition();
        if (!position || !saved.tracks.includes(position.path)) return;

        const source = position.source === "favorites"
          ? { id: "favorites" as const, tracks: saved.favorites }
          : saved.playlists.find((item) => item.id === position.source);
        if (source?.tracks.includes(position.path)) setQueue(source);
        setResumeAt(position.seconds);
        setActive(position.path);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function importTracks() {
    setNotice("");
    setBusy(true);
    setError("");
    try {
      const selected = await open({
        title: "Import tracks",
        multiple: true,
        filters: [{ name: "Audio", extensions: ["mp3", "wav"] }],
      });
      if (!selected?.length) return;
      await invoke("save_tracks", { paths: selected });
      setTracks((current) => [...new Set([...current, ...selected])]);
      if (!active) {
        const importedTracks = [...new Set([...tracks, ...selected])];
        startTrack(selected[0], undefined, importedTracks);
      }
    } catch {
      setError("Could not import the tracks. Check the files and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function importZip() {
    setBusy(true);
    setImportingArchive(true);
    setError("");
    setNotice("");
    try {
      const selected = await open({
        title: "Import ZIP",
        filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      });
      if (!selected) return;
      const { paths, added } = await invoke<ImportedArchive>("import_archive", { path: selected });
      setTracks((current) => [...new Set([...current, ...paths])]);
      setNotice(added === 0
        ? "This ZIP is already in your library."
        : `Imported ${added} ${added === 1 ? "track" : "tracks"} from ZIP.`);
    } catch (cause) {
      const detail = typeof cause === "string" ? cause : "Check the archive and try again.";
      setError(`Could not import ZIP. ${detail}`);
    } finally {
      setImportingArchive(false);
      setBusy(false);
    }
  }

  function navigate(id?: View) {
    setNotice("");
    setView(id);
    setSearch("");
    setCandidate("");
    setError("");
  }

  function editPlaylist(item?: Playlist) {
    setEditor(item?.id ?? "new");
    setName(item?.name ?? "");
    setError("");
  }

  async function savePlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = name.trim();
    if (!title || editor === undefined || busy) return;
    setBusy(true);
    setError("");
    try {
      if (editor === "new") {
        const created = await invoke<Playlist>("create_playlist", { name: title });
        setPlaylists((current) => [...current, created]);
        navigate(created.id);
      } else {
        await invoke("rename_playlist", { playlistId: editor, name: title });
        setPlaylists((current) => current.map((item) =>
          item.id === editor ? { ...item, name: title } : item,
        ));
      }
      setEditor(undefined);
    } catch {
      setError("Could not save the playlist.");
    } finally {
      setBusy(false);
    }
  }

  async function changePlaylistTrack(item: Playlist, path: string, action: "add" | "remove") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke(`${action}_playlist_track`, { playlistId: item.id, path });
      const updateTracks = (paths: string[]) => action === "add"
        ? [...new Set([...paths, path])]
        : paths.filter((track) => track !== path);
      setPlaylists((current) => current.map((entry) =>
        entry.id === item.id ? { ...entry, tracks: updateTracks(entry.tracks) } : entry,
      ));
      setQueue((current) => {
        if (current?.id !== item.id || (action === "remove" && path === active)) return current;
        return { ...current, tracks: updateTracks(current.tracks) };
      });
      setCandidate((current) => current === path ? "" : current);
    } catch {
      setError(action === "add" ? "Could not add the track to the playlist." : "Could not remove the track from the playlist.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(path: string) {
    if (busy) return;
    const favorite = !favoritePaths.has(path);
    const updateTracks = (paths: string[]) => favorite
      ? [...new Set([...paths, path])]
      : paths.filter((track) => track !== path);
    setBusy(true);
    setError("");
    try {
      await invoke("set_favorite", { path, favorite });
      setFavorites(updateTracks);
      setQueue((current) => {
        if (current?.id !== "favorites" || (!favorite && active === path)) return current;
        return { ...current, tracks: updateTracks(current.tracks) };
      });
    } catch {
      setError("Could not update favorites.");
    } finally {
      setBusy(false);
    }
  }

  function selectTrack(path: string) {
    if (path === active) return;
    setPlayback({ seconds: 0, duration: 0, playing: false });
    setFailedTrack(undefined);
    setResumeAt(undefined);
    setActive(path);
  }

  function startTrack(path: string, source?: Queue, libraryTracks = tracks) {
    if (path === active && source?.id === queue?.id) return;
    const paths = source?.tracks ?? libraryTracks;
    setQueue(source);
    setOrder(shuffle
      ? { ...emptyQueueOrder, tracks: [path, ...shuffleTracks(paths.filter((track) => track !== path))] }
      : undefined);
    selectTrack(path);
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

  function scheduleTrack(path: string, placement: "next" | "end") {
    if (!active) {
      startTrack(path, sourceQueue);
      return;
    }
    if (path === active) return;

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
    setNotice(placement === "next"
      ? `${trackName(path)} will play next.`
      : `${trackName(path)} is at the end of the queue.`);
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

  function savePosition(audio: HTMLAudioElement, force = false) {
    if (!active || audio.readyState < 1 || audio.seeking) return;
    const position = {
      path: active,
      seconds: audio.ended ? 0 : audio.currentTime,
      source: queue?.id,
    };
    const previous = lastPosition.current;
    if (!force && previous?.path === position.path && previous.source === position.source
      && Math.floor(previous.seconds) === Math.floor(position.seconds)) return;

    savePlaybackPosition(position);
    lastPosition.current = position;
  }

  function syncPlayback(audio: HTMLAudioElement) {
    const seconds = Math.round(audio.currentTime * 10) / 10;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const playing = !audio.paused && !audio.ended;
    setPlayback((current) => current.seconds === seconds && current.duration === duration && current.playing === playing
      ? current
      : { seconds, duration, playing });
  }

  function restorePosition(audio: HTMLAudioElement) {
    if (resumeAt && resumeAt < audio.duration) audio.currentTime = resumeAt;
    else savePosition(audio, true);
    syncPlayback(audio);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      const first = visibleTracks[0];
      if (first) startTrack(first, sourceQueue);
    } else if (audio.paused) {
      void audio.play().catch(() => setFailedTrack(active));
    } else {
      audio.pause();
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [active, muted, volume]);

  function playNext() {
    if (nextTrack) selectTrack(nextTrack);
  }

  usePlaybackControls(audioRef, active, active ? displayTitle(active) : undefined, previousTrack, nextTrack, selectTrack);

  return (
    <div className="shell">
      <TitleBar search={search} onSearch={setSearch} />
      <aside className="sidebar">
        <div className="wordmark">
          <img src="/m8-wordmark.svg" alt="M8" />
          <p>All your music. One place.</p>
        </div>
        <nav aria-label="Library and playlists">
          <button className="nav-item" aria-current={view === undefined ? "page" : undefined} onClick={() => navigate()}>
            <span aria-hidden="true">▤</span> Library
          </button>
          <button className="nav-item" aria-current={showingFavorites ? "page" : undefined} onClick={() => navigate("favorites")}>
            <span aria-hidden="true">♥</span> Favorites
          </button>
          <div className="nav-heading">
            <span>Playlists</span>
            <button className="icon-button" aria-label="New playlist" disabled={loading || busy} onClick={() => editPlaylist()}>+</button>
          </div>
          {editor !== undefined && (
            <form className="create" onSubmit={savePlaylist}>
              <input aria-label="Playlist name" placeholder="Playlist name" value={name} maxLength={80}
                onChange={(event) => setName(event.target.value)} autoFocus />
              <div className="form-actions">
                <button className="secondary" type="button" disabled={busy} onClick={() => setEditor(undefined)}>Cancel</button>
                <button className="primary" disabled={busy || !name.trim()}>{editor === "new" ? "Create" : "Save name"}</button>
              </div>
            </form>
          )}
          {playlists.map((item) => (
            <button key={item.id} className="nav-item" title={item.name}
              aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>
              <span aria-hidden="true">♫</span><span className="truncate">{item.name}</span>
            </button>
          ))}
        </nav>
        <p className="local-note"><span aria-hidden="true" /> Local storage</p>
      </aside>
      <main className="workspace">
        <header className={view === undefined ? "hero hero-home" : "hero"}>
          <div className="hero-copy">
            <div className="eyebrow">{playlist ? "Playlist" : "Your collection"}</div>
            <h1>{showingFavorites ? "Favorites" : playlist?.name ?? "All your music in one place."}</h1>
            <p>{view === undefined ? "Your library, favorites, and playlists." : `${visibleTracks.length} ${visibleTracks.length === 1 ? "track" : "tracks"}`}</p>
          </div>
          <div className="hero-actions">
            {playlist && <button className="secondary" disabled={busy} onClick={() => editPlaylist(playlist)}>Rename playlist</button>}
            <button className="secondary" disabled={loading || busy} onClick={importZip}>
              {importingArchive ? "Importing ZIP…" : "Import ZIP"}
            </button>
            <button className="primary" disabled={loading || busy} onClick={importTracks}>Import tracks</button>
          </div>
        </header>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <section className="library" aria-label="Tracks">
          <div className="section-heading">
            <div className="section-title">
              <h2>{view === undefined ? "Local library" : "Tracks"}</h2>
              <span>{displayedCount} {displayedCount === 1 ? "track" : "tracks"}</span>
            </div>
            {playlist && availableTracks.length > 0 && (
              <form className="add-track" onSubmit={(event) => {
                event.preventDefault();
                if (availableTracks.includes(candidate)) void changePlaylistTrack(playlist, candidate, "add");
              }}>
                <select aria-label="Track from library" value={candidate} onChange={(event) => setCandidate(event.target.value)}>
                  <option value="">Choose a track…</option>
                  {availableTracks.map((path) => <option key={path} value={path}>{trackName(path)}</option>)}
                </select>
                <button className="secondary" disabled={!candidate || busy}>Add</button>
              </form>
            )}
          </div>
          {loading ? (
            <p className="empty" role="status">Loading library…</p>
          ) : visibleTracks.length === 0 ? (
            <p className="empty">{showingFavorites
              ? "Select the heart next to a track to add it here."
              : playlist && availableTracks.length
                ? "Choose a track from your library to add."
                : "Import MP3 or WAV files to get started."}</p>
          ) : matches.length === 0 ? (
            <p className="empty" role="status">No tracks match your search.</p>
          ) : (
            <ol className="tracks">
              {matches.map(({ path, position }) => {
                const tags = metadata[path];
                const details = [tags?.artist, tags?.album].filter(Boolean).join(" · ");
                return (
                  <li className="track-row" key={path}>
                    <button className="track" aria-current={path === active ? "true" : undefined}
                      title={path} onClick={() => startTrack(path, sourceQueue)}>
                      <span className="track-index" aria-hidden="true">{path === active ? "♪" : position}</span>
                      <span className="track-text">
                        <span className="truncate">{displayTitle(path)}</span>
                        {details && <span className="track-caption truncate">{details}</span>}
                      </span>
                      <span className="format">
                        {path.split(".").pop()?.toUpperCase()}
                        {tags && tags.durationSeconds > 0 ? ` · ${formatDuration(tags.durationSeconds)}` : ""}
                      </span>
                    </button>
                    <button className="favorite-button" type="button" disabled={busy}
                      aria-label={`Favorite ${trackName(path)}`} aria-pressed={favoritePaths.has(path)}
                      title={favoritePaths.has(path) ? "Remove from favorites" : "Add to favorites"}
                      onClick={() => void toggleFavorite(path)}>
                      <span aria-hidden="true">{favoritePaths.has(path) ? "♥" : "♡"}</span>
                    </button>
                    <select className="row-action" aria-label={`Queue actions for ${trackName(path)}`} value=""
                      disabled={path === active} onChange={(event) => {
                        const placement = event.target.value;
                        if (placement === "next" || placement === "end") scheduleTrack(path, placement);
                      }}>
                      <option value="" disabled>Queue actions</option>
                      <option value="next">Play next</option>
                      <option value="end">Add to queue</option>
                    </select>
                    {playlist ? (
                      <button className="secondary row-action" disabled={busy}
                        aria-label={`Remove ${trackName(path)} from playlist`}
                        onClick={() => changePlaylistTrack(playlist, path, "remove")}>Remove</button>
                    ) : playlists.length > 0 && (
                      <select className="row-action" aria-label={`Add ${trackName(path)} to playlist`} value="" disabled={busy}
                        onChange={(event) => {
                          const target = playlists.find((item) => String(item.id) === event.target.value);
                          if (target) void changePlaylistTrack(target, path, "add");
                        }}>
                        <option value="" disabled>Add to playlist</option>
                        {playlists.map((item) => (
                          <option key={item.id} value={item.id} disabled={item.tracks.includes(path)}>{item.name}</option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
      <aside className="now-panel" aria-labelledby="now-panel-title">
        <section className="now-card">
          <h2 id="now-panel-title">Now Playing</h2>
          <div className="now-cover" aria-hidden="true">
            {cover ? <img src={cover} alt="" onError={clearCover} /> : <img src="/m8.svg" alt="" className="cover-placeholder" />}
          </div>
          <div className="now-details">
            <div className="now-copy">
              <h3>{active ? displayTitle(active) : "Nothing playing yet"}</h3>
              <p>{activeMetadata?.artist ?? (active ? "Local track" : "Choose a track to get started.")}</p>
            </div>
            {active && (
              <button className="favorite-button" type="button" disabled={busy} aria-label="Favorite current track"
                aria-pressed={favoritePaths.has(active)} onClick={() => void toggleFavorite(active)}>
                <span aria-hidden="true">{favoritePaths.has(active) ? "♥" : "♡"}</span>
              </button>
            )}
          </div>
          <div className="now-queue">
            <div className="section-heading">
              <h2>Up next</h2>
              <button className="text-button" type="button" aria-expanded={queueOpen}
                aria-controls="playback-queue" onClick={() => setQueueOpen((open) => !open)}>View queue</button>
            </div>
            {upcomingTracks.length ? (
              <ol className="next-preview">
                {upcomingTracks.slice(0, 3).map((path) => (
                  <li key={path}>
                    <button type="button" onClick={() => selectTrack(path)}>
                      <span className="preview-art" aria-hidden="true">♫</span>
                      <span className="truncate">{displayTitle(path)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : <p className="track-caption">No upcoming tracks.</p>}
          </div>
        </section>
      </aside>
      <footer className="player" aria-label="Player">
        <div className="player-track">
          <div className="track-art" aria-hidden="true">
            {cover ? <img src={cover} alt="" onError={clearCover} /> : "♫"}
          </div>
          <div className="track-details">
            <div className="eyebrow">Now playing</div>
            <p className="truncate" title={active}>{active ? displayTitle(active) : "No track selected"}</p>
            {activeMetadata?.artist && <div className="track-caption truncate">{activeMetadata.artist}</div>}
          </div>
        </div>
        <div className="transport">
          <div className="transport-buttons">
            <button className="secondary playback-mode" type="button" aria-pressed={shuffle}
              onClick={toggleShuffle}>Shuffle</button>
            <button className="secondary skip-track" type="button" aria-label="Previous track" aria-keyshortcuts="Control+ArrowLeft" title="Previous track (Ctrl+Left)"
              disabled={!previousTrack} onClick={() => {
                if (previousTrack) selectTrack(previousTrack);
              }}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h2v12H5zm10 0L7 10l8 6z" /></svg>
            </button>
            <button className="play-button" type="button" aria-label={playback.playing ? "Pause" : "Play"}
              disabled={!active && !visibleTracks.length} onClick={togglePlayback}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {playback.playing ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="M8 4v16l13-8z" />}
              </svg>
            </button>
            <button className="secondary skip-track" type="button" aria-label="Next track" aria-keyshortcuts="Control+ArrowRight" title="Next track (Ctrl+Right)"
              disabled={!nextTrack} onClick={playNext}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4h2v12h-2zM5 4l8 6-8 6z" /></svg>
            </button>
            <button className="secondary playback-mode" type="button" data-active={repeat !== "off"}
              onClick={() => setRepeat((mode) => nextRepeatMode[mode])}>Repeat: {repeat}</button>
          </div>
          <div className="seek-controls">
            <span>{formatDuration(playback.seconds)}</span>
            <input type="range" aria-label="Playback position" min={0} max={playback.duration || 1}
              value={Math.min(playback.seconds, playback.duration)} step={0.1} disabled={!playback.duration}
              style={{ "--range-progress": `${playback.duration ? Math.min(100, playback.seconds / playback.duration * 100) : 0}%` } as CSSProperties}
              onChange={(event) => {
                const audio = audioRef.current;
                if (audio) {
                  audio.currentTime = event.target.valueAsNumber;
                  syncPlayback(audio);
                }
              }} />
            <span>{formatDuration(playback.duration)}</span>
          </div>
          {active && (
            <audio key={active} ref={audioRef} src={convertFileSrc(active)} hidden
              autoPlay={resumeAt === undefined} loop={repeat === "one" || (repeat === "all" && queuedTracks.length === 1)}
              onLoadedMetadata={(event) => restorePosition(event.currentTarget)}
              onDurationChange={(event) => syncPlayback(event.currentTarget)}
              onPlay={(event) => syncPlayback(event.currentTarget)}
              onTimeUpdate={(event) => {
                syncPlayback(event.currentTarget);
                savePosition(event.currentTarget);
              }}
              onPause={(event) => {
                syncPlayback(event.currentTarget);
                savePosition(event.currentTarget, true);
              }}
              onSeeked={(event) => {
                syncPlayback(event.currentTarget);
                savePosition(event.currentTarget, true);
              }}
              onEnded={(event) => {
                syncPlayback(event.currentTarget);
                savePosition(event.currentTarget, true);
                playNext();
              }}
              onError={(event) => {
                syncPlayback(event.currentTarget);
                setFailedTrack(active);
              }} />
          )}
        </div>
        <div className="playback-options">
          <button className="volume-button" type="button" aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted(!muted)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 9h4l5-4v14l-5-4H3z"/>
              {muted ? <path d="m16 9 5 6m0-6-5 6"/> : <path d="M16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>}
            </svg>
          </button>
          <input className="volume-slider" type="range" aria-label="Volume" min={0} max={1} step={0.01}
            value={muted ? 0 : volume} style={{ "--range-progress": `${muted ? 0 : volume * 100}%` } as CSSProperties}
            onChange={(event) => {
              setVolume(event.target.valueAsNumber);
              setMuted(false);
            }} />
          <button className="secondary queue-toggle" type="button" aria-expanded={queueOpen}
            aria-controls="playback-queue" onClick={() => setQueueOpen((open) => !open)}>Queue</button>
        </div>
        <section id="playback-queue" className="queue-panel" aria-labelledby="queue-title" hidden={!queueOpen}>
          <h2 id="queue-title">Up next</h2>
          {upcomingTracks.length > 0 ? (
            <ol>
              {upcomingTracks.map((path, index) => (
                <li key={path}>
                  <div className="queue-row">
                    <button className="queue-track truncate" type="button" title={displayTitle(path)}
                      onClick={() => selectTrack(path)}>{displayTitle(path)}</button>
                    <button className="secondary queue-action" type="button" disabled={index === 0}
                      aria-label={`Move ${trackName(path)} up`} title="Move up"
                      onClick={() => moveUpcoming(index, -1)}>↑</button>
                    <button className="secondary queue-action" type="button" disabled={index === upcomingTracks.length - 1}
                      aria-label={`Move ${trackName(path)} down`} title="Move down"
                      onClick={() => moveUpcoming(index, 1)}>↓</button>
                    <button className="secondary queue-action" type="button"
                      aria-label={`Remove ${trackName(path)} from queue`} title="Remove from queue"
                      onClick={() => removeUpcoming(path)}>×</button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>{active ? "No upcoming tracks." : "Play a track to start the queue."}</p>
          )}
        </section>
        {active && failedTrack === active && <p className="error" role="alert">Check that the file is still in its original folder.</p>}
      </footer>
    </div>
  );
}
