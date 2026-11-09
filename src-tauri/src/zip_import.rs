use std::{
    error::Error,
    fs::{self, File},
    io::{self, BufReader, Read, Seek},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::is_audio_path;

const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TRACK_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;

pub(crate) struct StagedArchive {
    pub(crate) directory: tempfile::TempDir,
    pub(crate) destination: PathBuf,
    pub(crate) tracks: Vec<PathBuf>,
}

pub(crate) fn stage(
    archive_path: &Path,
    media_directory: &Path,
) -> Result<StagedArchive, Box<dyn Error>> {
    let file = File::open(archive_path)?;
    if file.metadata()?.len() > MAX_ARCHIVE_BYTES {
        return Err("The ZIP exceeds the 2 GiB import limit.".into());
    }
    let mut reader = BufReader::new(file);
    let mut hash = Sha256::new();
    if io::copy(&mut (&mut reader).take(MAX_ARCHIVE_BYTES + 1), &mut hash)? > MAX_ARCHIVE_BYTES {
        return Err("The ZIP exceeds the 2 GiB import limit.".into());
    }
    reader.rewind()?;
    let mut archive = ZipArchive::new(reader)?;
    if archive.len() > MAX_ENTRIES {
        return Err("The ZIP contains too many entries.".into());
    }

    fs::create_dir_all(media_directory)?;
    let directory = tempfile::tempdir_in(media_directory)?;
    let destination = media_directory.join(format!("{:x}", hash.finalize()));
    let mut tracks = Vec::new();
    let mut total_size = 0;

    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        if !entry.is_file() || entry.is_symlink() {
            continue;
        }
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        if !is_audio_path(&path) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let size = entry.size();
        if size == 0 {
            continue;
        }
        if size > MAX_TRACK_BYTES || size > MAX_ARCHIVE_BYTES - total_size {
            return Err("The audio in the ZIP exceeds the import size limit.".into());
        }
        total_size += size;

        // Numbered folders keep equal file names separate without trusting ZIP directories.
        let folder = directory.path().join(index.to_string());
        fs::create_dir(&folder)?;
        let name = safe_file_name(name);
        let mut output = File::create(folder.join(&name))?;
        if io::copy(&mut entry.take(size + 1), &mut output)? != size {
            return Err("An audio entry has an invalid size.".into());
        }
        output.sync_all()?;
        tracks.push(destination.join(index.to_string()).join(name));
    }

    if tracks.is_empty() {
        return Err("No MP3 or WAV tracks were found in the ZIP.".into());
    }
    Ok(StagedArchive {
        directory,
        destination,
        tracks,
    })
}

fn safe_file_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let device = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    let numbered_device = ["COM", "LPT"].iter().any(|prefix| {
        device.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    });
    if matches!(
        device.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || numbered_device
    {
        format!("_{name}")
    } else {
        name
    }
}
