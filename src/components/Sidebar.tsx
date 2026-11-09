import { useState } from "react";
import type { FormEvent } from "react";
import { smartPlaylists } from "../lib/smartPlaylists";
import type { Playlist, View, WatchedFolder } from "../types";

/** The playlist being created ("new") or renamed (its id). */
export type PlaylistEditor = { id: number | "new"; name: string };

type SidebarProps = {
  view: View | undefined;
  playlists: Playlist[];
  loading: boolean;
  busy: boolean;
  editor: PlaylistEditor | undefined;
  watchedFolders: WatchedFolder[];
  onAddFolder: () => void;
  onRemoveFolder: (folder: WatchedFolder) => void;
  onNavigate: (view?: View) => void;
  onNewPlaylist: () => void;
  onSavePlaylist: (name: string) => void;
  onCancelEdit: () => void;
};

export default function Sidebar({
  view, playlists, loading, busy, editor, watchedFolders, onAddFolder, onRemoveFolder, onNavigate, onNewPlaylist, onSavePlaylist, onCancelEdit,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="wordmark">
        <img src="/infinity-one.svg" alt="" />
        <span>Infinity One</span>
        <p>All your music. One place.</p>
      </div>
      <nav aria-label="Library and playlists">
        <button className="nav-item" aria-current={view === undefined ? "page" : undefined} onClick={() => onNavigate()}>
          <span aria-hidden="true">▤</span> Library
        </button>
        <button className="nav-item" aria-current={view === "favorites" ? "page" : undefined} onClick={() => onNavigate("favorites")}>
          <span aria-hidden="true">♥</span> Favorites
        </button>
        <div className="nav-heading">
          <span>Smart playlists</span>
        </div>
        {smartPlaylists.map((item) => (
          <button key={item.id} className="nav-item" title={item.description}
            aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}>
            <span aria-hidden="true">✦</span><span className="truncate">{item.name}</span>
          </button>
        ))}
        <div className="nav-heading">
          <span>Playlists</span>
          <button className="icon-button" aria-label="New playlist" disabled={loading || busy} onClick={onNewPlaylist}>+</button>
        </div>
        {editor && (
          <PlaylistForm key={editor.id} editor={editor} busy={busy} onSave={onSavePlaylist} onCancel={onCancelEdit} />
        )}
        {playlists.map((item) => (
          <button key={item.id} className="nav-item" title={item.name}
            aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}>
            <span aria-hidden="true">♫</span><span className="truncate">{item.name}</span>
          </button>
        ))}
      </nav>
      <section className="watched" aria-labelledby="watched-heading">
        <div className="nav-heading">
          <span id="watched-heading">Watched folders</span>
          <button className="icon-button" aria-label="Watch a folder" title="Import new MP3, WAV, and ZIP files from a folder automatically"
            disabled={loading || busy} onClick={onAddFolder}>+</button>
        </div>
        {watchedFolders.length === 0 ? (
          <p className="watched-empty">Watch your downloads folder to import new tracks automatically.</p>
        ) : (
          <ul>
            {watchedFolders.map((folder) => (
              <li key={folder.id} className="watched-folder" title={folder.path}>
                <span aria-hidden="true">▣</span>
                <span className="truncate">{folderName(folder.path)}</span>
                <button type="button" className="watched-remove" disabled={busy}
                  aria-label={`Stop watching ${folderName(folder.path)}`} title="Stop watching"
                  onClick={() => onRemoveFolder(folder)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="local-note"><span aria-hidden="true" /> Local storage</p>
    </aside>
  );
}

function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

type PlaylistFormProps = {
  editor: PlaylistEditor;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
};

function PlaylistForm({ editor, busy, onSave, onCancel }: PlaylistFormProps) {
  const [name, setName] = useState(editor.name);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = name.trim();
    if (title && !busy) onSave(title);
  }

  return (
    <form className="create" onSubmit={submit}>
      <input aria-label="Playlist name" placeholder="Playlist name" value={name} maxLength={80}
        onChange={(event) => setName(event.target.value)} autoFocus />
      <div className="form-actions">
        <button className="secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy || !name.trim()}>{editor.id === "new" ? "Create" : "Save name"}</button>
      </div>
    </form>
  );
}
