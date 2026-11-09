mod track_metadata;
mod zip_import;

use std::{fs, path::Path, sync::Mutex};

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

struct Library(Mutex<Connection>);

fn track_paths(connection: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut query = connection.prepare("SELECT path FROM tracks ORDER BY id")?;
    query.query_map([], |row| row.get(0))?.collect()
}

#[derive(serde::Serialize)]
struct Playlist {
    id: i64,
    name: String,
    tracks: Vec<String>,
}

#[derive(serde::Serialize)]
struct SavedLibrary {
    tracks: Vec<String>,
    playlists: Vec<Playlist>,
    favorites: Vec<String>,
}

fn playlists(connection: &Connection) -> rusqlite::Result<Vec<Playlist>> {
    let mut query = connection.prepare(
        "SELECT p.id, p.name, t.path
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         LEFT JOIN tracks t ON t.id = pt.track_id
         ORDER BY p.id, pt.id",
    )?;
    let mut rows = query.query([])?;
    let mut result: Vec<Playlist> = Vec::new();
    while let Some(row) = rows.next()? {
        let id = row.get(0)?;
        if result.last().is_none_or(|playlist| playlist.id != id) {
            result.push(Playlist {
                id,
                name: row.get(1)?,
                tracks: Vec::new(),
            });
        }
        if let Some(path) = row.get::<_, Option<String>>(2)? {
            result
                .last_mut()
                .expect("playlist for current row")
                .tracks
                .push(path);
        }
    }
    Ok(result)
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
    let connection = library.0.lock().map_err(|error| error.to_string())?;
    connection
        .execute("INSERT INTO playlists (name) VALUES (?1)", [name])
        .map_err(|error| error.to_string())?;
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
    let connection = library.0.lock().map_err(|error| error.to_string())?;
    let changed = connection
        .execute(
            "UPDATE playlists SET name = ?1 WHERE id = ?2",
            rusqlite::params![name, playlist_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Playlist not found.".into());
    }
    Ok(())
}

#[tauri::command]
fn remove_playlist_track(
    library: State<'_, Library>,
    playlist_id: i64,
    path: String,
) -> Result<(), String> {
    let connection = library.0.lock().map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM playlist_tracks
             WHERE playlist_id = ?1 AND track_id = (SELECT id FROM tracks WHERE path = ?2)",
            rusqlite::params![playlist_id, path],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_playlist_track(
    library: State<'_, Library>,
    playlist_id: i64,
    path: String,
) -> Result<(), String> {
    let connection = library.0.lock().map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id)
         VALUES (?1, (SELECT id FROM tracks WHERE path = ?2))
         ON CONFLICT(playlist_id, track_id) DO NOTHING",
            rusqlite::params![playlist_id, path],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn favorite_paths(connection: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut query = connection.prepare(
        "SELECT t.path FROM favorites f JOIN tracks t ON t.id = f.track_id ORDER BY f.id",
    )?;
    query.query_map([], |row| row.get(0))?.collect()
}

#[tauri::command]
fn set_favorite(library: State<'_, Library>, path: String, favorite: bool) -> Result<(), String> {
    let connection = library.0.lock().map_err(|error| error.to_string())?;
    let sql = if favorite {
        "INSERT INTO favorites (track_id) VALUES ((SELECT id FROM tracks WHERE path = ?1))
         ON CONFLICT(track_id) DO NOTHING"
    } else {
        "DELETE FROM favorites WHERE track_id = (SELECT id FROM tracks WHERE path = ?1)"
    };
    connection
        .execute(sql, [path])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_library(app: AppHandle, library: State<'_, Library>) -> Result<SavedLibrary, String> {
    let connection = library.0.lock().map_err(|error| error.to_string())?;
    let tracks = track_paths(&connection).map_err(|error| error.to_string())?;
    let scope = app.asset_protocol_scope();
    for track in &tracks {
        scope.allow_file(track).map_err(|error| error.to_string())?;
    }
    let playlists = playlists(&connection).map_err(|error| error.to_string())?;
    let favorites = favorite_paths(&connection).map_err(|error| error.to_string())?;
    Ok(SavedLibrary {
        tracks,
        playlists,
        favorites,
    })
}

fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("mp3") || extension.eq_ignore_ascii_case("wav")
        })
}

fn insert_tracks(connection: &Connection, paths: &[String]) -> rusqlite::Result<usize> {
    let mut insert =
        connection.prepare("INSERT INTO tracks (path) VALUES (?1) ON CONFLICT(path) DO NOTHING")?;
    paths
        .iter()
        .try_fold(0, |added, path| Ok(added + insert.execute([path])?))
}

#[derive(serde::Serialize)]
struct ImportedArchive {
    paths: Vec<String>,
    added: usize,
}

#[tauri::command]
async fn import_archive(app: AppHandle, path: String) -> Result<ImportedArchive, String> {
    tauri::async_runtime::spawn_blocking(move || import_archive_on_disk(&app, &path))
        .await
        .map_err(|error| error.to_string())?
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
        .map_err(|error| error.to_string())?
        .join("imports");
    let staged = zip_import::stage(file, &media_directory).map_err(|error| error.to_string())?;
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
    let mut connection = library.0.lock().map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let added = insert_tracks(&transaction, &paths).map_err(|error| error.to_string())?;
    let publish = !staged.destination.exists();
    if publish {
        fs::rename(staged.directory.path(), &staged.destination)
            .map_err(|error| error.to_string())?;
    }
    let finish = || -> Result<(), String> {
        for track in &staged.tracks {
            if !track.is_file() {
                return Err("An imported audio file is missing from local storage.".into());
            }
            scope.allow_file(track).map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    };
    if let Err(error) = finish() {
        if publish {
            let _ = fs::rename(&staged.destination, staged.directory.path());
        }
        return Err(error);
    }

    Ok(ImportedArchive { paths, added })
}

#[tauri::command]
fn save_tracks(
    app: AppHandle,
    library: State<'_, Library>,
    paths: Vec<String>,
) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    for path in &paths {
        let file = Path::new(path);
        if !is_audio_path(file) || !file.is_absolute() || !scope.is_allowed(file) || !file.is_file()
        {
            return Err("Select MP3 or WAV files available on disk.".into());
        }
    }

    let mut connection = library.0.lock().map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    insert_tracks(&transaction, &paths).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            fs::create_dir_all(&directory)?;
            let connection = Connection::open(directory.join("library.sqlite3"))?;
            connection.execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE IF NOT EXISTS tracks (
                    id INTEGER PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS favorites (
                    id INTEGER PRIMARY KEY,
                    track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id)
                );
                CREATE TABLE IF NOT EXISTS playlists (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS playlist_tracks (
                    id INTEGER PRIMARY KEY,
                    playlist_id INTEGER NOT NULL REFERENCES playlists(id),
                    track_id INTEGER NOT NULL REFERENCES tracks(id),
                    UNIQUE (playlist_id, track_id)
                );",
            )?;
            app.manage(Library(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            track_metadata::read_track_metadata,
            track_metadata::read_track_artwork,
            save_tracks,
            import_archive,
            set_favorite,
            create_playlist,
            add_playlist_track,
            rename_playlist,
            remove_playlist_track
        ])
        .run(tauri::generate_context!())
        .expect("error while running M8");
}
