import { useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
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
import type { Playlist, Queue, SavedLibrary, Track, TrackId, View } from "./types";
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
  const trackIds = library.tracks.map((track) => track.id);
  const queue = useQueue({ tracks: trackIds, active: player.active, selectTrack: player.selectTrack });
  const { metadata, cover, clearCover } = useTrackMetadata(library.tracks, player.active);

  const { active } = player;
  const { busy } = status;
  const tracksById = new Map(library.tracks.map((track) => [track.id, track]));
  const resolve = (ids: TrackId[]) => ids.flatMap((id) => tracksById.get(id) ?? []);
  const title = (id: TrackId) => {
    const track = tracksById.get(id);
    return track ? trackTitle(track, metadata[id]) : "Unknown track";
  };
  const name = (id: TrackId) => {
    const track = tracksById.get(id);
    return track ? trackName(track) : "Unknown track";
  };
  const playlist = library.playlists.find((item) => item.id === view);
  const favorites = new Set(library.favorites);
  const visibleIds = view === "favorites" ? library.favorites : playlist?.tracks ?? trackIds;
  const sourceQueue: Queue | undefined = view === "favorites"
    ? { id: "favorites", tracks: library.favorites }
    : playlist;
  const availableTracks = playlist ? library.tracks.filter((track) => !playlist.tracks.includes(track.id)) : [];

  usePlaybackControls(player.audioRef, active, active ? title(active) : undefined,
    queue.previousTrack, queue.nextTrack, player.selectTrack);

  /** Loads the saved track paused at its saved position, with its collection as the queue source. */
  function restorePlayback(saved: SavedLibrary) {
    const position = loadPlaybackPosition((path) =>
      saved.tracks.find((track) => track.source === "local" && track.location === path)?.id);
    if (!position || !saved.tracks.some((track) => track.id === position.track)) return;
    const source = position.source === "favorites"
      ? { id: "favorites" as const, tracks: saved.favorites }
      : saved.playlists.find((item) => item.id === position.source);
    if (source?.tracks.includes(position.track)) queue.setSource(source);
    player.resume(position.track, position.seconds);
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
      const saved = await library.saveTracks(selected);
      if (!active) queue.startTrack(saved[0].id, undefined, [...new Set([...trackIds, ...saved.map((track) => track.id)])]);
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

  async function removeTrack(track: Track) {
    if (busy) return;
    const confirmed = await ask(
      `Remove "${title(track.id)}" from your library? It is also removed from your playlists and Favorites. The audio file is not deleted.`,
      { title: "Remove from library", kind: "warning", okLabel: "Remove", cancelLabel: "Cancel" },
    );
    if (!confirmed) return;
    status.setNotice("");
    await status.run(async () => {
      await library.removeTrack(track.id);
      queue.forget(track.id);
      if (active === track.id) player.stop();
      status.setNotice(`Removed ${trackName(track)} from your library.`);
    }, "Could not remove the track.");
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

  async function deletePlaylist(item: Playlist) {
    if (busy) return;
    const confirmed = await ask(
      `Delete the playlist "${item.name}"? Its tracks stay in your library.`,
      { title: "Delete playlist", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" },
    );
    if (!confirmed) return;
    await status.run(async () => {
      await library.deletePlaylist(item.id);
      if (editor?.id === item.id) setEditor(undefined);
      if (view === item.id) navigate();
    }, "Could not delete the playlist.");
  }

  function setPlaylistTrack(item: Playlist, track: TrackId, included: boolean) {
    if (busy) return;
    void status.run(async () => {
      await library.setPlaylistTrack(item.id, track, included);
      // Keep the playing track in the queue until playback moves on.
      if (included || track !== active) {
        queue.updateSource(item.id, (ids) => included ? withTrack(ids, track) : withoutTrack(ids, track));
      }
    }, included ? "Could not add the track to the playlist." : "Could not remove the track from the playlist.");
  }

  function toggleFavorite(track: TrackId) {
    if (busy) return;
    const favorite = !favorites.has(track);
    void status.run(async () => {
      await library.setFavorite(track, favorite);
      if (favorite || track !== active) {
        queue.updateSource("favorites", (ids) => favorite ? withTrack(ids, track) : withoutTrack(ids, track));
      }
    }, "Could not update favorites.");
  }

  function scheduleTrack(track: TrackId, placement: "next" | "end") {
    if (!queue.scheduleTrack(track, placement, sourceQueue)) return;
    status.setNotice(placement === "next"
      ? `${name(track)} will play next.`
      : `${name(track)} is at the end of the queue.`);
  }

  function togglePlayback() {
    if (player.togglePlayback()) return;
    const first = visibleIds[0];
    if (first !== undefined) queue.startTrack(first, sourceQueue);
  }

  const toggleQueue = () => setQueueOpen((open) => !open);
  const artist = active ? metadata[active]?.artist : undefined;

  return (
    <div className="shell">
      <TitleBar search={search} onSearch={setSearch} />
      <Sidebar view={view} playlists={library.playlists} loading={library.loading} busy={busy} editor={editor}
        onNavigate={navigate} onNewPlaylist={() => editPlaylist()} onSavePlaylist={savePlaylist}
        onCancelEdit={() => setEditor(undefined)} />
      <main className="workspace">
        <CollectionHeader view={view} playlist={playlist} trackCount={visibleIds.length}
          loading={library.loading} busy={busy} importingArchive={importingArchive}
          onRename={editPlaylist} onDelete={(item) => void deletePlaylist(item)}
          onImportZip={importZip} onImportTracks={importTracks} />
        {status.error && <p className="error" role="alert">{status.error}</p>}
        {status.notice && <p className="notice" role="status">{status.notice}</p>}
        <TrackList view={view} playlist={playlist} playlists={library.playlists} tracks={resolve(visibleIds)}
          availableTracks={availableTracks} search={search} active={active} metadata={metadata}
          favorites={favorites} loading={library.loading} busy={busy}
          onPlay={(track) => queue.startTrack(track, sourceQueue)} onToggleFavorite={toggleFavorite}
          onSchedule={scheduleTrack} onSetPlaylistTrack={setPlaylistTrack}
          onRemove={(track) => void removeTrack(track)} />
      </main>
      <NowPanel active={active} title={active ? title(active) : undefined}
        artist={artist} cover={cover} onCoverError={clearCover}
        favorite={active !== undefined && favorites.has(active)} busy={busy} onToggleFavorite={toggleFavorite}
        upcoming={queue.upcomingTracks.slice(0, 3).map((id) => ({ id, title: title(id) }))}
        queueOpen={queueOpen} onToggleQueue={toggleQueue} onSelect={player.selectTrack} />
      <PlayerBar player={player} queue={queue} track={active ? tracksById.get(active) : undefined}
        title={title} name={name} artist={artist} cover={cover} onCoverError={clearCover}
        canStart={visibleIds.length > 0} onTogglePlayback={togglePlayback}
        queueOpen={queueOpen} onToggleQueue={toggleQueue} />
    </div>
  );
}
