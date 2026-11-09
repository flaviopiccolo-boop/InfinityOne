import { useState } from "react";
import type { FormEvent } from "react";
import type { Playlist, View } from "../types";

/** The playlist being created ("new") or renamed (its id). */
export type PlaylistEditor = { id: number | "new"; name: string };

type SidebarProps = {
  view: View | undefined;
  playlists: Playlist[];
  loading: boolean;
  busy: boolean;
  editor: PlaylistEditor | undefined;
  onNavigate: (view?: View) => void;
  onNewPlaylist: () => void;
  onSavePlaylist: (name: string) => void;
  onCancelEdit: () => void;
};

export default function Sidebar({
  view, playlists, loading, busy, editor, onNavigate, onNewPlaylist, onSavePlaylist, onCancelEdit,
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
      <p className="local-note"><span aria-hidden="true" /> Local storage</p>
    </aside>
  );
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
