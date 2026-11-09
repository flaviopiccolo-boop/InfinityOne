import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import type { PlaylistEditor } from "./components/Sidebar";
import CollectionHeader from "./components/CollectionHeader";
import TrackList from "./components/TrackList";
import NowPanel from "./components/NowPanel";
import PlayerBar from "./components/PlayerBar";
import { useLibrary } from "./hooks/useLibrary";
import { usePlayer } from "./hooks/usePlayer";
import { useQueue } from "./hooks/useQueue";
import { useStatus } from "./hooks/useStatus";
import { usePlaybackControls } from "./hooks/usePlaybackControls";
import { useTrackMetadata } from "./hooks/useTrackMetadata";
import { loadPlaybackPosition } from "./lib/playbackPosition";
import { trackName, trackTitle, withoutTrack, withTrack } from "./lib/tracks";
import type { Playlist, Queue, SavedLibrary, View } from "./types";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<PlaylistEditor>();
  const [queueOpen, setQueueOpen] = useState(false);
  const [importingArchive, setImportingArchive] = useState(false);

  const status = useStatus();
  const player = usePlayer();
  const library = useLibrary({
    onLoaded: restorePlayback,
    onLoadError: () => status.setError("Could not load the library."),
  });
  const queue = useQueue({ tracks: library.tracks, active: player.active, selectTrack: player.selectTrack });
  const { metadata, cover, clearCover } = useTrackMetadata(library.tracks, player.active);

  const { active } = player;
  const { busy } = status;
  const title = (path: string) => trackTitle(path, metadata[path]);
  const playlist = library.playlists.find((item) => item.id === view);
  const favorites = new Set(library.favorites);
  const visibleTracks = view === "favorites" ? library.favorites : playlist?.tracks ?? library.tracks;
  const sourceQueue: Queue | undefined = view === "favorites"
    ? { id: "favorites", tracks: library.favorites }
    : playlist;
  const availableTracks = playlist ? library.tracks.filter((path) => !playlist.tracks.includes(path)) : [];

  usePlaybackControls(player.audioRef, active, active ? title(active) : undefined,
    queue.previousTrack, queue.nextTrack, player.selectTrack);

  /** Loads the saved track paused at its saved position, with its collection as the queue source. */
  function restorePlayback(saved: SavedLibrary) {
    const position = loadPlaybackPosition();
    if (!position || !saved.tracks.includes(position.path)) return;
    const source = position.source === "favorites"
      ? { id: "favorites" as const, tracks: saved.favorites }
      : saved.playlists.find((item) => item.id === position.source);
    if (source?.tracks.includes(position.path)) queue.setSource(source);
    player.resume(position.path, position.seconds);
  }

  function navigate(id?: View) {
    setView(id);
    setSearch("");
    status.clear();
  }

  function importTracks() {
    status.setNotice("");
    void status.run(async () => {
      const selected = await open({
        title: "Import tracks",
        multiple: true,
        filters: [{ name: "Audio", extensions: ["mp3", "wav"] }],
      });
      if (!selected?.length) return;
      await library.saveTracks(selected);
      if (!active) queue.startTrack(selected[0], undefined, [...new Set([...library.tracks, ...selected])]);
    }, "Could not import the tracks. Check the files and try again.");
  }

  function importZip() {
    status.setNotice("");
    void status.run(async () => {
      setImportingArchive(true);
      try {
        const selected = await open({
          title: "Import ZIP",
          filters: [{ name: "ZIP archive", extensions: ["zip"] }],
        });
        if (!selected) return;
        const { added } = await library.importArchive(selected);
        status.setNotice(added === 0
          ? "This ZIP is already in your library."
          : `Imported ${added} ${added === 1 ? "track" : "tracks"} from ZIP.`);
      } finally {
        setImportingArchive(false);
      }
    }, (cause) => `Could not import ZIP. ${typeof cause === "string" ? cause : "Check the archive and try again."}`);
  }

  function editPlaylist(item?: Playlist) {
    setEditor({ id: item?.id ?? "new", name: item?.name ?? "" });
    status.setError("");
  }

  function savePlaylist(name: string) {
    if (!editor || busy) return;
    void status.run(async () => {
      if (editor.id === "new") {
        const created = await library.createPlaylist(name);
        navigate(created.id);
      } else {
        await library.renamePlaylist(editor.id, name);
      }
      setEditor(undefined);
    }, "Could not save the playlist.");
  }

  function setPlaylistTrack(item: Playlist, path: string, included: boolean) {
    if (busy) return;
    void status.run(async () => {
      await library.setPlaylistTrack(item.id, path, included);
      // Keep the playing track in the queue until playback moves on.
      if (included || path !== active) {
        queue.updateSource(item.id, (paths) => included ? withTrack(paths, path) : withoutTrack(paths, path));
      }
    }, included ? "Could not add the track to the playlist." : "Could not remove the track from the playlist.");
  }

  function toggleFavorite(path: string) {
    if (busy) return;
    const favorite = !favorites.has(path);
    void status.run(async () => {
      await library.setFavorite(path, favorite);
      if (favorite || path !== active) {
        queue.updateSource("favorites", (paths) => favorite ? withTrack(paths, path) : withoutTrack(paths, path));
      }
    }, "Could not update favorites.");
  }

  function scheduleTrack(path: string, placement: "next" | "end") {
    if (!queue.scheduleTrack(path, placement, sourceQueue)) return;
    status.setNotice(placement === "next"
      ? `${trackName(path)} will play next.`
      : `${trackName(path)} is at the end of the queue.`);
  }

  function togglePlayback() {
    if (player.togglePlayback()) return;
    const first = visibleTracks[0];
    if (first) queue.startTrack(first, sourceQueue);
  }

  const toggleQueue = () => setQueueOpen((open) => !open);

  return (
    <div className="shell">
      <TitleBar search={search} onSearch={setSearch} />
      <Sidebar view={view} playlists={library.playlists} loading={library.loading} busy={busy} editor={editor}
        onNavigate={navigate} onNewPlaylist={() => editPlaylist()} onSavePlaylist={savePlaylist}
        onCancelEdit={() => setEditor(undefined)} />
      <main className="workspace">
        <CollectionHeader view={view} playlist={playlist} trackCount={visibleTracks.length}
          loading={library.loading} busy={busy} importingArchive={importingArchive}
          onRename={editPlaylist} onImportZip={importZip} onImportTracks={importTracks} />
        {status.error && <p className="error" role="alert">{status.error}</p>}
        {status.notice && <p className="notice" role="status">{status.notice}</p>}
        <TrackList view={view} playlist={playlist} playlists={library.playlists} tracks={visibleTracks}
          availableTracks={availableTracks} search={search} active={active} metadata={metadata}
          favorites={favorites} loading={library.loading} busy={busy}
          onPlay={(path) => queue.startTrack(path, sourceQueue)} onToggleFavorite={toggleFavorite}
          onSchedule={scheduleTrack} onSetPlaylistTrack={setPlaylistTrack} />
      </main>
      <NowPanel active={active} title={active ? title(active) : undefined}
        artist={active ? metadata[active]?.artist : undefined} cover={cover} onCoverError={clearCover}
        favorite={active !== undefined && favorites.has(active)} busy={busy} onToggleFavorite={toggleFavorite}
        upcoming={queue.upcomingTracks.slice(0, 3).map((path) => ({ path, title: title(path) }))}
        queueOpen={queueOpen} onToggleQueue={toggleQueue} onSelect={player.selectTrack} />
      <PlayerBar player={player} queue={queue} title={title}
        artist={active ? metadata[active]?.artist : undefined} cover={cover} onCoverError={clearCover}
        canStart={visibleTracks.length > 0} onTogglePlayback={togglePlayback}
        queueOpen={queueOpen} onToggleQueue={toggleQueue} />
    </div>
  );
}
