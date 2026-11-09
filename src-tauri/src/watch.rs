//! Imports new audio and ZIP files that appear in the folders the user watches.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, UNIX_EPOCH},
};

use notify_debouncer_mini::{
    DebounceEventResult, Debouncer, new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    Library,
    db::{self, Track, WatchedFolder},
};

/// Waits for a file to stop changing before importing it, so downloads finish first.
const SETTLE: Duration = Duration::from_secs(2);

/// Sent to the window with the tracks that were added.
pub(crate) const TRACKS_ADDED: &str = "tracks-added";

#[derive(Default)]
pub(crate) struct Watcher(Mutex<Option<Debouncer<RecommendedWatcher>>>);

/// (Re)starts watching every saved folder. Subfolders are not watched.
pub(crate) fn start(app: &AppHandle) -> Result<(), String> {
    let folders =
        db::watched_folders(&*app.state::<Library>().lock()?).map_err(|e| e.to_string())?;
    let handle = app.clone();
    let mut debouncer = new_debouncer(SETTLE, move |result: DebounceEventResult| {
        if let Ok(events) = result {
            ingest(
                &handle,
                events.into_iter().map(|event| event.path).collect(),
            );
        }
    })
    .map_err(|error| error.to_string())?;
    for folder in &folders {
        if let Err(error) = debouncer
            .watcher()
            .watch(Path::new(&folder.path), RecursiveMode::NonRecursive)
        {
            eprintln!("Could not watch {}: {error}", folder.path);
        }
    }
    let watcher = app.state::<Watcher>();
    *watcher.0.lock().map_err(|error| error.to_string())? = Some(debouncer);
    Ok(())
}

/// Imports files already in the folders without blocking the caller.
pub(crate) fn scan_in_background(app: &AppHandle, folders: Vec<WatchedFolder>) {
    let app = app.clone();
    thread::spawn(move || {
        let paths = folders
            .iter()
            .filter_map(|folder| fs::read_dir(&folder.path).ok())
            .flatten()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        ingest(&app, paths);
    });
}

/// Whether a file looks like something to import. Hidden and temporary files are skipped;
/// browsers download to a temporary name and rename the file when it is complete.
fn is_candidate(path: &Path) -> bool {
    let hidden = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_none_or(|name| name.starts_with('.') || name.starts_with("~$"));
    !hidden && (crate::is_audio_path(path) || crate::is_zip_path(path))
}

fn file_version(path: &Path) -> Option<(i64, i64)> {
    let metadata = fs::metadata(path)
        .ok()
        .filter(|metadata| metadata.is_file())?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some((
        i64::try_from(metadata.len()).ok()?,
        i64::try_from(modified).ok()?,
    ))
}

fn import_file(app: &AppHandle, path: &Path, location: &str) -> Result<Vec<Track>, String> {
    if crate::is_zip_path(path) {
        let imported = crate::import_zip(app, path)?;
        return Ok(if imported.added > 0 {
            imported.tracks
        } else {
            Vec::new()
        });
    }
    let (tracks, added) =
        db::insert_local_tracks(&*app.state::<Library>().lock()?, &[location.to_owned()])
            .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|error| error.to_string())?;
    Ok(if added > 0 { tracks } else { Vec::new() })
}

/// Imports each new or changed file once and tells the window about added tracks.
fn ingest(app: &AppHandle, mut paths: Vec<PathBuf>) {
    paths.sort();
    paths.dedup();
    let mut added = Vec::new();
    for path in paths.iter().filter(|path| is_candidate(path)) {
        let (Some((size, modified)), Some(location)) = (file_version(path), path.to_str()) else {
            continue;
        };
        let seen = app
            .state::<Library>()
            .lock()
            .and_then(|connection| {
                db::is_seen(&connection, location, size, modified).map_err(|e| e.to_string())
            })
            .unwrap_or(true);
        if seen {
            continue;
        }
        match import_file(app, path, location) {
            Ok(tracks) => added.extend(tracks),
            Err(error) => eprintln!("Could not import {location}: {error}"),
        }
        // Mark failures as seen too, so a broken file is retried only after it changes.
        if let Ok(connection) = app.state::<Library>().lock() {
            let _ = db::mark_seen(&connection, location, size, modified);
        }
    }
    if !added.is_empty() {
        let _ = app.emit(TRACKS_ADDED, added);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_audio_and_zip_files_only() {
        assert!(is_candidate(Path::new("C:/Downloads/Neon Skyline.mp3")));
        assert!(is_candidate(Path::new("C:/Downloads/batch.ZIP")));
        assert!(is_candidate(Path::new("C:/Downloads/take.wav")));
        assert!(!is_candidate(Path::new("C:/Downloads/song.mp3.crdownload")));
        assert!(!is_candidate(Path::new("C:/Downloads/song.mp3.part")));
        assert!(!is_candidate(Path::new("C:/Downloads/.hidden.mp3")));
        assert!(!is_candidate(Path::new("C:/Downloads/~$lock.mp3")));
        assert!(!is_candidate(Path::new("C:/Downloads/cover.jpg")));
    }
}
