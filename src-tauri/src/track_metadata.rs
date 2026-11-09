use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use lofty::{
    config::ParseOptions,
    file::{AudioFile, TaggedFileExt},
    picture::{MimeType, PictureType},
    probe::Probe,
    tag::ItemKey,
};
use tauri::{AppHandle, Manager};

const MAX_ARTWORK_BYTES: usize = 2 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    /// Often holds the prompt or style description for generated music.
    comment: Option<String>,
    lyrics: Option<String>,
    /// The music generator that made the file, when its tags say so.
    generator: Option<Generator>,
    duration_seconds: f64,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub(crate) struct Generator {
    name: &'static str,
    /// A link to the track on the generator's site.
    url: Option<String>,
}

/// Longer tag values are cut, so one file cannot flood the window.
const MAX_TEXT_CHARS: usize = 20_000;

/// Generators by name, the domain of their site, and phrases (whole words, lower case)
/// that name them in a tag.
const GENERATORS: &[(&str, &str, &[&str])] = &[
    ("Suno", "suno.com", &["suno", "suno ai", "suno com"]),
    ("Udio", "udio.com", &["udio", "udio com"]),
    (
        "Google Flow Music",
        "labs.google",
        &["flow music", "flowmusic"],
    ),
    ("Riffusion", "riffusion.com", &["riffusion"]),
];

fn clean(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    (!value.is_empty()).then(|| value.chars().take(MAX_TEXT_CHARS).collect())
}

/// Lower-case words separated by single spaces, padded so phrases match whole words.
fn words(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect();
    format!(
        " {} ",
        normalized.split_whitespace().collect::<Vec<_>>().join(" ")
    )
}

/// Finds the generator named in tag values, with a link to the track when one is present.
fn detect_generator<'a>(values: impl Iterator<Item = &'a str> + Clone) -> Option<Generator> {
    let &(name, domain, _) = GENERATORS.iter().find(|(_, domain, phrases)| {
        values.clone().any(|value| {
            let text = words(value);
            value.to_lowercase().contains(domain)
                || phrases
                    .iter()
                    .any(|phrase| text.contains(&format!(" {phrase} ")))
        })
    })?;
    let url = values
        .flat_map(str::split_whitespace)
        .find(|word| {
            let word = word.to_lowercase();
            word.starts_with("https://") && word.contains(domain)
        })
        .map(|word| word.trim_end_matches(['.', ',', ')', '"', '\'']).to_owned());
    Some(Generator { name, url })
}

fn read_metadata(path: &Path) -> Option<TrackMetadata> {
    let options = ParseOptions::new().read_cover_art(false);
    let file = Probe::open(path).ok()?.options(options).read().ok()?;
    let tags = file.primary_tag().into_iter().chain(file.tags());
    let first = |key: ItemKey| tags.clone().find_map(|tag| clean(tag.get_string(key)));
    let values = tags
        .clone()
        .flat_map(|tag| tag.items())
        .filter_map(|item| item.value().text().or_else(|| item.value().locator()));
    Some(TrackMetadata {
        title: first(ItemKey::TrackTitle),
        artist: first(ItemKey::TrackArtist),
        album: first(ItemKey::AlbumTitle),
        genre: first(ItemKey::Genre),
        comment: first(ItemKey::Comment),
        lyrics: first(ItemKey::UnsyncLyrics).or_else(|| first(ItemKey::Lyrics)),
        generator: detect_generator(values),
        duration_seconds: file.properties().duration().as_secs_f64(),
    })
}

/// The file behind each local track that can be read, keyed by track id.
fn readable_paths(app: &AppHandle, track_ids: &[i64]) -> Result<Vec<(i64, PathBuf)>, String> {
    let library = app.state::<crate::Library>();
    let connection = library.lock()?;
    let scope = app.asset_protocol_scope();
    let mut paths = Vec::with_capacity(track_ids.len());
    for &id in track_ids {
        let path =
            crate::db::local_track_path(&connection, id).map_err(|error| error.to_string())?;
        if let Some(path) = path
            .filter(|path| crate::is_audio_path(path) && scope.is_allowed(path) && path.is_file())
        {
            paths.push((id, path));
        }
    }
    Ok(paths)
}

#[tauri::command]
pub(crate) async fn read_track_metadata(
    app: AppHandle,
    track_ids: Vec<i64>,
) -> Result<HashMap<i64, TrackMetadata>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(readable_paths(&app, &track_ids)?
            .into_iter()
            .filter_map(|(id, path)| Some((id, read_metadata(&path)?)))
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn read_track_artwork(
    app: AppHandle,
    track_id: i64,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some((_, file)) = readable_paths(&app, &[track_id])?.pop() else {
            return Ok(None);
        };
        Ok(read_artwork(&file))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn read_artwork(file: &Path) -> Option<String> {
    let options = ParseOptions::new().read_properties(false);
    let tagged = Probe::open(file).ok()?.options(options).read().ok()?;
    let (picture, mime) = tagged
        .tags()
        .iter()
        .flat_map(|tag| tag.pictures())
        .filter_map(|picture| {
            if picture.data().is_empty() || picture.data().len() > MAX_ARTWORK_BYTES {
                return None;
            }
            let mime = match picture.mime_type()? {
                MimeType::Jpeg => "image/jpeg",
                MimeType::Png => "image/png",
                _ => return None,
            };
            Some((picture, mime))
        })
        .min_by_key(|(picture, _)| picture.pic_type() != PictureType::CoverFront)?;
    Some(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(picture.data())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detect(values: &[&str]) -> Option<Generator> {
        detect_generator(values.iter().copied())
    }

    #[test]
    fn detects_the_generator_and_its_link() {
        assert_eq!(
            detect(&[
                "Neon Skyline",
                "made with suno; created=2026-11-01; id=abc https://suno.com/song/1234-abcd."
            ]),
            Some(Generator {
                name: "Suno",
                url: Some("https://suno.com/song/1234-abcd".into())
            })
        );
        assert_eq!(
            detect(&["Udio"]),
            Some(Generator {
                name: "Udio",
                url: None
            })
        );
        assert_eq!(detect(&["Paper Satellites", "Indie folk"]), None);
        // Names count only as whole words.
        assert_eq!(detect(&["Recorded in my studio", "audio", "Sunoco"]), None);
        assert_eq!(
            detect(&["https://labs.google/fx/tools/music/abc"]),
            Some(Generator {
                name: "Google Flow Music",
                url: Some("https://labs.google/fx/tools/music/abc".into())
            })
        );
    }
}
