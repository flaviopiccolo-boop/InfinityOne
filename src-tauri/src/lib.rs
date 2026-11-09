mod db;
mod track_metadata;
mod zip_import;

use std::{fs, path::Path, sync::Mutex};

use db::{Playlist, Track};
use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

struct Library(Mutex<Connection>);

fn error_text(error: impl ToString) -> String {
    error.to_string()
}

impl Library {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.0.lock().map_err(error_text)
    }
}

#[derive(serde::Serialize)]
struct SavedLibrary {
    tracks: Vec<Track>,
    playlists: Vec<Playlist>,
    favorites: Vec<i64>,
}

fn playlist_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Enter a playlist name of up to 80 characters.".into());
    }
    Ok(name)
}

#[tauri::command]
fn create_playlist(library: State<'_, Library>, name: String) -> Result<Playlist, String> {
    let name = playlist_name(&name)?;
    let connection = library.lock()?;
    connection
        .execute("INSERT INTO playlists (name) VALUES (?1)", [name])
        .map_err(error_text)?;
    Ok(Playlist {
        id: connection.last_insert_rowid(),
        name: name.into(),
        tracks: Vec::new(),
    })
}

#[tauri::command]
fn rename_playlist(
    library: State<'_, Library>,
    playlist_id: i64,
    name: String,
) -> Result<(), String> {
    let name = playlist_name(&name)?;
    let changed = library
        .lock()?
        .execute(
            "UPDATE playlists SET name = ?1 WHERE id = ?2",
            rusqlite::params![name, playlist_id],
        )
        .map_err(error_text)?;
    if changed == 0 {
        return Err("Playlist not found.".into());
    }
    Ok(())
}

#[tauri::command]
fn delete_playlist(library: State<'_, Library>, playlist_id: i64) -> Result<(), String> {
    library
        .lock()?
        .execute("DELETE FROM playlists WHERE id = ?1", [playlist_id])
        .map_err(error_text)?;
    Ok(())
}

#[tauri::command]
fn add_playlist_track(
    library: State<'_, Library>,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    library
        .lock()?
        .execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id) VALUES (?1, ?2)
             ON CONFLICT(playlist_id, track_id) DO NOTHING",
            rusqlite::params![playlist_id, track_id],
        )
        .map_err(error_text)?;
    Ok(())
}

#[tauri::command]
fn remove_playlist_track(
    library: State<'_, Library>,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    library
        .lock()?
        .execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            rusqlite::params![playlist_id, track_id],
        )
        .map_err(error_text)?;
    Ok(())
}

#[tauri::command]
fn set_favorite(library: State<'_, Library>, track_id: i64, favorite: bool) -> Result<(), String> {
    let sql = if favorite {
        "INSERT INTO favorites (track_id) VALUES (?1) ON CONFLICT(track_id) DO NOTHING"
    } else {
        "DELETE FROM favorites WHERE track_id = ?1"
    };
    library
        .lock()?
        .execute(sql, [track_id])
        .map_err(error_text)?;
    Ok(())
}

/// Removes a track from the library, its playlists, and Favorites.
/// The audio file stays where it is.
#[tauri::command]
fn remove_track(library: State<'_, Library>, track_id: i64) -> Result<(), String> {
    if !db::remove_track(&*library.lock()?, track_id).map_err(error_text)? {
        return Err("Track not found.".into());
    }
    Ok(())
}

fn allow_tracks(app: &AppHandle, tracks: &[Track]) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    for path in tracks.iter().filter_map(Track::local_path) {
        scope.allow_file(path).map_err(error_text)?;
    }
    Ok(())
}

#[tauri::command]
fn load_library(app: AppHandle, library: State<'_, Library>) -> Result<SavedLibrary, String> {
    let connection = library.lock()?;
    let tracks = db::tracks(&connection).map_err(error_text)?;
    allow_tracks(&app, &tracks)?;
    Ok(SavedLibrary {
        tracks,
        playlists: db::playlists(&connection).map_err(error_text)?,
        favorites: db::favorites(&connection).map_err(error_text)?,
    })
}

fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("mp3") || extension.eq_ignore_ascii_case("wav")
        })
}

#[derive(serde::Serialize)]
struct ImportedArchive {
    tracks: Vec<Track>,
    added: usize,
}

#[tauri::command]
async fn import_archive(app: AppHandle, path: String) -> Result<ImportedArchive, String> {
    tauri::async_runtime::spawn_blocking(move || import_archive_on_disk(&app, &path))
        .await
        .map_err(error_text)?
}

fn import_archive_on_disk(app: &AppHandle, path: &str) -> Result<ImportedArchive, String> {
    let file = Path::new(path);
    let scope = app.asset_protocol_scope();
    if !file.is_absolute()
        || !file
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        || !scope.is_allowed(file)
        || !file.is_file()
    {
        return Err("Select a ZIP file available on disk.".into());
    }

    let media_directory = app
        .path()
        .app_local_data_dir()
        .map_err(error_text)?
        .join("imports");
    let staged = zip_import::stage(file, &media_directory).map_err(error_text)?;
    let paths: Vec<String> = staged
        .tracks
        .iter()
        .map(|path| {
            path.to_str()
                .map(str::to_owned)
                .ok_or("The track path is not valid UTF-8.")
        })
        .collect::<Result<_, _>>()?;

    let library = app.state::<Library>();
    let mut connection = library.lock()?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error_text)?;
    let (mut tracks, added) = db::insert_local_tracks(&transaction, &paths).map_err(error_text)?;
    let publish = !staged.destination.exists();
    if publish {
        fs::rename(staged.directory.path(), &staged.destination).map_err(error_text)?;
    }
    let finish = || -> Result<(), String> {
        for track in &staged.tracks {
            if !track.is_file() {
                return Err("An imported audio file is missing from local storage.".into());
            }
            scope.allow_file(track).map_err(error_text)?;
        }
        transaction.commit().map_err(error_text)
    };
    if let Err(error) = finish() {
        if publish {
            let _ = fs::rename(&staged.destination, staged.directory.path());
        }
        return Err(error);
    }
    // The files were staged elsewhere when the tracks were read, so recheck them.
    for track in &mut tracks {
        track.missing = false;
    }

    Ok(ImportedArchive { tracks, added })
}

#[tauri::command]
fn save_tracks(
    app: AppHandle,
    library: State<'_, Library>,
    paths: Vec<String>,
) -> Result<Vec<Track>, String> {
    let scope = app.asset_protocol_scope();
    for path in &paths {
        let file = Path::new(path);
        if !is_audio_path(file) || !file.is_absolute() || !scope.is_allowed(file) || !file.is_file()
        {
            return Err("Select MP3 or WAV files available on disk.".into());
        }
    }

    let mut connection = library.lock()?;
    let transaction = connection.transaction().map_err(error_text)?;
    let (tracks, _) = db::insert_local_tracks(&transaction, &paths).map_err(error_text)?;
    transaction.commit().map_err(error_text)?;
    Ok(tracks)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            fs::create_dir_all(&directory)?;
            let connection = db::open(&directory.join("library.sqlite3"))?;
            app.manage(Library(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            track_metadata::read_track_metadata,
            track_metadata::read_track_artwork,
            save_tracks,
            import_archive,
            remove_track,
            set_favorite,
            create_playlist,
            rename_playlist,
            delete_playlist,
            add_playlist_track,
            remove_playlist_track
        ])
        .run(tauri::generate_context!())
        .expect("error while running Infinity One");
}
