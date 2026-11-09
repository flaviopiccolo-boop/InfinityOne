mod db;
mod track_metadata;
mod watch;
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

#[tauri::command]
fn set_rating(
    library: State<'_, Library>,
    track_id: i64,
    rating: Option<u8>,
) -> Result<(), String> {
    if rating.is_some_and(|stars| !(1..=5).contains(&stars)) {
        return Err("Choose a rating from 1 to 5 stars.".into());
    }
    if !db::set_rating(&*library.lock()?, track_id, rating).map_err(error_text)? {
        return Err("Track not found.".into());
    }
    Ok(())
}

#[tauri::command]
fn record_play(library: State<'_, Library>, track_id: i64) -> Result<db::PlayStats, String> {
    db::record_play(&*library.lock()?, track_id)
        .map_err(error_text)?
        .ok_or_else(|| "Track not found.".into())
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

fn is_zip_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

fn import_archive_on_disk(app: &AppHandle, path: &str) -> Result<ImportedArchive, String> {
    let file = Path::new(path);
    if !file.is_absolute()
        || !is_zip_path(file)
        || !app.asset_protocol_scope().is_allowed(file)
        || !file.is_file()
    {
        return Err("Select a ZIP file available on disk.".into());
    }
    import_zip(app, file)
}

/// Copies the audio in a ZIP to app storage and adds it to the library.
/// The caller checks that `file` is a ZIP the app may read.
fn import_zip(app: &AppHandle, file: &Path) -> Result<ImportedArchive, String> {
    let scope = app.asset_protocol_scope();
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

#[tauri::command]
fn list_watched_folders(library: State<'_, Library>) -> Result<Vec<db::WatchedFolder>, String> {
    db::watched_folders(&*library.lock()?).map_err(error_text)
}

/// Starts importing new MP3, WAV, and ZIP files from a folder, including the ones already there.
#[tauri::command]
fn add_watched_folder(app: AppHandle, path: String) -> Result<db::WatchedFolder, String> {
    let folder = Path::new(&path);
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("Select a folder available on disk.".into());
    }
    let added =
        db::add_watched_folder(&*app.state::<Library>().lock()?, &path).map_err(error_text)?;
    watch::start(&app)?;
    watch::scan_in_background(&app, vec![added.clone()]);
    Ok(added)
}

/// Stops watching a folder. Tracks already imported from it stay in the library.
#[tauri::command]
fn remove_watched_folder(app: AppHandle, folder_id: i64) -> Result<(), String> {
    db::remove_watched_folder(&*app.state::<Library>().lock()?, folder_id).map_err(error_text)?;
    watch::start(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            fs::create_dir_all(&directory)?;
            let connection = db::open(&directory.join("library.sqlite3"))?;
            let folders = db::watched_folders(&connection)?;
            app.manage(Library(Mutex::new(connection)));
            app.manage(watch::Watcher::default());
            let handle = app.handle();
            if let Err(error) = watch::start(handle) {
                eprintln!("Could not watch folders: {error}");
            }
            watch::scan_in_background(handle, folders);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            track_metadata::read_track_metadata,
            track_metadata::read_track_artwork,
            save_tracks,
            import_archive,
            remove_track,
            set_rating,
            record_play,
            set_favorite,
            create_playlist,
            rename_playlist,
            delete_playlist,
            add_playlist_track,
            remove_playlist_track,
            list_watched_folders,
            add_watched_folder,
            remove_watched_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Infinity One");
}
