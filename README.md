# Infinity One

Infinity One is a local music player for Windows. Import MP3 or WAV files, select a track, and use the playback controls. The library plays tracks in import order, and playlists play tracks in the order you added them. SQLite stores track paths and playlists locally. Audio files stay in their original folders.

## Windows development

Install Node.js, Rust with the MSVC toolchain, Microsoft C++ Build Tools, and WebView2. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev
```

Run `npm run build` to build the frontend or `npm run tauri build` to package the desktop app.

## Smoke test

1. Open Infinity One and import two MP3 or WAV files.
2. Play the first track, pause it, and seek within it.
3. Let the first track finish and verify that the second starts automatically.
4. Click **+** beside **Playlists**, create a playlist, and add an imported track.
5. Close and reopen Infinity One. Verify that the tracks and playlist are still available and that the tracks play.


## Organize your library

Use **Search tracks** to filter the current library or playlist. Open the track’s **More actions** menu to add it to a playlist. Open a playlist to rename it or remove tracks from it. Removing a track from a playlist keeps it in your library.

## Import a ZIP archive

Choose **Import ZIP** to add MP3 and WAV tracks from an archive, including a batch download from Google Flow Music. Infinity One copies the audio to its local app storage, so the original ZIP can be moved after import. Importing the same ZIP again skips existing tracks. The maximum is 2 GiB per archive or batch of extracted audio and 512 MiB per track.

Select the heart beside a track to add it to **Favorites**. Open **Favorites** in the sidebar to search or play the saved collection. Select the heart again to remove the track from Favorites.

## Playback queue

Use **Previous track** and **Next track** in the player to move within the active collection. Open **Queue** to see upcoming tracks and jump to one. Searching or browsing another collection leaves playback in the current queue until you select a different track or collection.

Turn on **Shuffle** to randomize upcoming tracks. Turn it off to restore collection order for the remaining tracks. **Repeat** cycles through off, all, and one. Use **More actions** beside a track to play it next or move it to the end of the queue, even when browsing another collection. If no track is selected, either action starts playback. In **Up next**, use the arrows to change the order or **Remove from queue** to skip a track for the current queue. Starting playback from a different track in the library or a playlist starts a new queue.

## Resume playback

Infinity One saves the active track and playback position locally. When you reopen the app, the track is loaded at the saved position and stays paused until you press Play. If the track still belongs to the playlist or Favorites collection you started from, Infinity One restores that collection as the playback source.

## Keyboard and media controls

- **Space** plays or pauses the selected track when focus is outside an interactive control.
- **Ctrl+Left Arrow** selects the previous track.
- **Ctrl+Right Arrow** selects the next track.

Infinity One also exposes play, pause, previous track, and next track through Media Session. Windows and hardware media controls depend on the WebView2 runtime and device.

## Track metadata and artwork

Infinity One reads embedded title, artist, and album tags and shows the duration of MP3 and WAV files when available. Search matches these text tags and the original filename. The player shows the current track’s embedded JPEG or PNG artwork up to 2 MiB. Files without tags still appear by filename.
