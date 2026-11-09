use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

/// Where a track comes from. Only local files exist today; services such as Suno
/// can be added as new sources with their own `location` format.
pub(crate) const LOCAL_SOURCE: &str = "local";

/// Schema changes in order. A migration runs once, when `PRAGMA user_version`
/// is lower than its position + 1. Never edit a released migration; add a new one.
const MIGRATIONS: &[&str] = &[
    // 1: the schema used before migrations existed. `IF NOT EXISTS` lets
    // libraries created by those versions adopt it unchanged.
    "CREATE TABLE IF NOT EXISTS tracks (
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
    // 2: identify tracks by source and location instead of a file path, and
    // remove favorites and playlist entries together with their track or playlist.
    "CREATE TABLE tracks_v2 (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        location TEXT NOT NULL,
        UNIQUE (source, location)
    );
    INSERT INTO tracks_v2 (id, source, location) SELECT id, 'local', path FROM tracks;
    DROP TABLE tracks;
    ALTER TABLE tracks_v2 RENAME TO tracks;

    CREATE TABLE favorites_v2 (
        id INTEGER PRIMARY KEY,
        track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE
    );
    INSERT INTO favorites_v2 SELECT id, track_id FROM favorites;
    DROP TABLE favorites;
    ALTER TABLE favorites_v2 RENAME TO favorites;

    CREATE TABLE playlist_tracks_v2 (
        id INTEGER PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        UNIQUE (playlist_id, track_id)
    );
    INSERT INTO playlist_tracks_v2 SELECT id, playlist_id, track_id FROM playlist_tracks;
    DROP TABLE playlist_tracks;
    ALTER TABLE playlist_tracks_v2 RENAME TO playlist_tracks;",
];

pub(crate) fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut connection = Connection::open(path)?;
    migrate(&mut connection)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(connection)
}

/// Applies pending migrations, each in its own transaction.
///
/// Foreign keys are off while migrating so tables can be rebuilt, as SQLite
/// recommends; each migration is checked for broken references before commit.
fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > MIGRATIONS.len() as i64 {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "The library was created by a newer version of Infinity One (schema {version})."
        )));
    }
    for (index, migration) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration)?;
        let broken: Option<String> = transaction
            .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
            .optional()?;
        if let Some(table) = broken {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "Migration {} left broken references in {table}.",
                index + 1
            )));
        }
        transaction.pragma_update(None, "user_version", index as i64 + 1)?;
        transaction.commit()?;
    }
    Ok(())
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub(crate) struct Track {
    pub(crate) id: i64,
    pub(crate) source: String,
    pub(crate) location: String,
    /// A local file that is no longer on disk.
    pub(crate) missing: bool,
}

impl Track {
    pub(crate) fn local_path(&self) -> Option<&Path> {
        (self.source == LOCAL_SOURCE).then(|| Path::new(&self.location))
    }
}

fn track_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    let source: String = row.get(1)?;
    let location: String = row.get(2)?;
    let missing = source == LOCAL_SOURCE && !Path::new(&location).is_file();
    Ok(Track {
        id: row.get(0)?,
        source,
        location,
        missing,
    })
}

pub(crate) fn tracks(connection: &Connection) -> rusqlite::Result<Vec<Track>> {
    let mut query = connection.prepare("SELECT id, source, location FROM tracks ORDER BY id")?;
    query.query_map([], track_from_row)?.collect()
}

/// Adds local files to the library, skipping ones already in it, and returns
/// the track for every path in the order given along with the number added.
pub(crate) fn insert_local_tracks(
    connection: &Connection,
    paths: &[String],
) -> rusqlite::Result<(Vec<Track>, usize)> {
    let mut insert = connection.prepare(
        "INSERT INTO tracks (source, location) VALUES (?1, ?2)
         ON CONFLICT(source, location) DO NOTHING",
    )?;
    let mut select = connection
        .prepare("SELECT id, source, location FROM tracks WHERE source = ?1 AND location = ?2")?;
    let mut added = 0;
    let mut result = Vec::with_capacity(paths.len());
    for path in paths {
        added += insert.execute(params![LOCAL_SOURCE, path])?;
        result.push(select.query_row(params![LOCAL_SOURCE, path], track_from_row)?);
    }
    Ok((result, added))
}

/// The file behind a local track, if the track exists and is local.
pub(crate) fn local_track_path(
    connection: &Connection,
    track_id: i64,
) -> rusqlite::Result<Option<PathBuf>> {
    connection
        .query_row(
            "SELECT location FROM tracks WHERE id = ?1 AND source = ?2",
            params![track_id, LOCAL_SOURCE],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map(|location| location.map(PathBuf::from))
}

pub(crate) fn remove_track(connection: &Connection, track_id: i64) -> rusqlite::Result<bool> {
    Ok(connection.execute("DELETE FROM tracks WHERE id = ?1", [track_id])? > 0)
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub(crate) struct Playlist {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) tracks: Vec<i64>,
}

pub(crate) fn playlists(connection: &Connection) -> rusqlite::Result<Vec<Playlist>> {
    let mut query = connection.prepare(
        "SELECT p.id, p.name, pt.track_id
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
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
        if let Some(track_id) = row.get::<_, Option<i64>>(2)? {
            result
                .last_mut()
                .expect("playlist for current row")
                .tracks
                .push(track_id);
        }
    }
    Ok(result)
}

pub(crate) fn favorites(connection: &Connection) -> rusqlite::Result<Vec<i64>> {
    let mut query = connection.prepare("SELECT track_id FROM favorites ORDER BY id")?;
    query.query_map([], |row| row.get(0))?.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_library() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(MIGRATIONS[0])
            .and_then(|()| {
                connection.execute_batch(
                    "INSERT INTO tracks (id, path) VALUES (1, 'C:/music/a.mp3'), (2, 'C:/music/b.wav');
                     INSERT INTO favorites (track_id) VALUES (2);
                     INSERT INTO playlists (id, name) VALUES (7, 'Mix'), (8, 'Empty');
                     INSERT INTO playlist_tracks (playlist_id, track_id) VALUES (7, 2), (7, 1);",
                )
            })
            .unwrap();
        connection
    }

    fn version(connection: &Connection) -> i64 {
        connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn migrates_a_legacy_library_without_losing_data() {
        let mut connection = legacy_library();
        migrate(&mut connection).unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();

        assert_eq!(version(&connection), MIGRATIONS.len() as i64);
        let tracks = tracks(&connection).unwrap();
        assert_eq!(
            tracks
                .iter()
                .map(|track| (track.id, track.source.as_str(), track.location.as_str()))
                .collect::<Vec<_>>(),
            [
                (1, LOCAL_SOURCE, "C:/music/a.mp3"),
                (2, LOCAL_SOURCE, "C:/music/b.wav")
            ]
        );
        assert!(tracks.iter().all(|track| track.missing));
        assert_eq!(favorites(&connection).unwrap(), [2]);
        assert_eq!(
            playlists(&connection).unwrap(),
            [
                Playlist {
                    id: 7,
                    name: "Mix".into(),
                    tracks: vec![2, 1]
                },
                Playlist {
                    id: 8,
                    name: "Empty".into(),
                    tracks: vec![]
                },
            ]
        );
    }

    #[test]
    fn migrating_twice_changes_nothing() {
        let mut connection = legacy_library();
        migrate(&mut connection).unwrap();
        migrate(&mut connection).unwrap();
        assert_eq!(version(&connection), MIGRATIONS.len() as i64);
        assert_eq!(tracks(&connection).unwrap().len(), 2);
    }

    #[test]
    fn removing_a_track_or_playlist_removes_its_entries() {
        let mut connection = legacy_library();
        migrate(&mut connection).unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();

        assert!(remove_track(&connection, 2).unwrap());
        assert!(favorites(&connection).unwrap().is_empty());
        assert_eq!(playlists(&connection).unwrap()[0].tracks, [1]);

        connection
            .execute("DELETE FROM playlists WHERE id = 7", [])
            .unwrap();
        let entries: i64 = connection
            .query_row("SELECT COUNT(*) FROM playlist_tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(entries, 0);
    }

    #[test]
    fn inserting_local_tracks_skips_existing_ones() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        let paths = ["C:/a.mp3".to_owned(), "C:/b.mp3".to_owned()];
        let (first, added) = insert_local_tracks(&connection, &paths).unwrap();
        assert_eq!(added, 2);
        let (second, added) = insert_local_tracks(&connection, &paths[1..]).unwrap();
        assert_eq!(added, 0);
        assert_eq!(second[0].id, first[1].id);
        assert_eq!(
            local_track_path(&connection, first[0].id).unwrap(),
            Some("C:/a.mp3".into())
        );
    }

    #[test]
    fn refuses_a_library_from_a_newer_version() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1)
            .unwrap();
        assert!(migrate(&mut connection).is_err());
    }
}
