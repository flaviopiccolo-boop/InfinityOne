import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type TitleBarProps = { search: string; onSearch: (value: string) => void };

export default function TitleBar({ search, onSearch }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [appWindow] = useState(getCurrentWindow);

  useEffect(() => {
    let disposed = false;
    const syncMaximized = () => {
      void appWindow.isMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      }).catch(console.error);
    };
    syncMaximized();
    const unlisten = appWindow.onResized(syncMaximized);
    void unlisten.catch(console.error);

    return () => {
      disposed = true;
      void unlisten.then((stop) => stop()).catch(console.error);
    };
  }, [appWindow]);

  const maximizeLabel = maximized ? "Restore window" : "Maximize window";

  return (
    <header className="title-bar">
      <div className="title-bar-drag" data-tauri-drag-region>
        <img src="/infinity-one.svg" alt="" draggable={false} data-tauri-drag-region />
        <span data-tauri-drag-region>Infinity One</span>
      </div>
      <label className="title-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></svg>
        <input type="search" aria-label="Search tracks" placeholder="Search tracks, artists, albums…"
          value={search} onChange={(event) => onSearch(event.target.value)} />
      </label>
      <div className="title-bar-spacer" data-tauri-drag-region />
      <div className="window-controls" role="group" aria-label="Window controls">
        <button type="button" aria-label="Minimize window" title="Minimize window"
          onClick={() => void appWindow.minimize().catch(console.error)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10" /></svg>
        </button>
        <button type="button" aria-label={maximizeLabel} title={maximizeLabel}
          onClick={() => void appWindow.toggleMaximize().catch(console.error)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {maximized
              ? <path d="M5.5 5.5v-2h7v7h-2m-7-5h7v7h-7z" />
              : <path d="M3.5 3.5h9v9h-9z" />}
          </svg>
        </button>
        <button className="window-close" type="button" aria-label="Close window" title="Close window"
          onClick={() => void appWindow.close().catch(console.error)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
      </div>
    </header>
  );
}
