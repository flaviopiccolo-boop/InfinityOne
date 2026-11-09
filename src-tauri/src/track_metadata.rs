use std::{collections::HashMap, path::Path};

use base64::{Engine, engine::general_purpose::STANDARD};
use lofty::{
    config::ParseOptions,
    file::{AudioFile, TaggedFileExt},
    picture::{MimeType, PictureType},
    probe::Probe,
    tag::Accessor,
};
use tauri::{AppHandle, Manager};

const MAX_ARTWORK_BYTES: usize = 2 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_seconds: f64,
}

fn clean(value: Option<std::borrow::Cow<'_, str>>) -> Option<String> {
    let value = value.as_deref()?.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn read_metadata(path: &Path) -> Option<TrackMetadata> {
    let options = ParseOptions::new().read_cover_art(false);
    let file = Probe::open(path).ok()?.options(options).read().ok()?;
    let tags = file.primary_tag().into_iter().chain(file.tags());
    Some(TrackMetadata {
        title: tags.clone().find_map(|tag| clean(tag.title())),
        artist: tags.clone().find_map(|tag| clean(tag.artist())),
        album: tags.clone().find_map(|tag| clean(tag.album())),
        duration_seconds: file.properties().duration().as_secs_f64(),
    })
}

#[tauri::command]
pub(crate) async fn read_track_metadata(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<HashMap<String, TrackMetadata>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.asset_protocol_scope();
        paths
            .into_iter()
            .filter_map(|path| {
                let file = Path::new(&path);
                if !crate::is_audio_path(file) || !scope.is_allowed(file) || !file.is_file() {
                    return None;
                }
                let metadata = read_metadata(file)?;
                Some((path, metadata))
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn read_track_artwork(
    app: AppHandle,
    path: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = Path::new(&path);
        if !crate::is_audio_path(file)
            || !app.asset_protocol_scope().is_allowed(file)
            || !file.is_file()
        {
            return None;
        }
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
    })
    .await
    .map_err(|error| error.to_string())
}
