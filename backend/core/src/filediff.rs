use crate::diff::{Block, Options, compare_with};
use crate::error::{Error, Result};
use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;
use ts_rs::TS;

const BINARY_PROBE: usize = 8000;
const SIZE_LIMIT: usize = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 10] = [
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tif", "tiff", "heic",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Content {
    Text,
    Binary,
    Image,
    TooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffSide {
    pub text: String,
    pub exists: bool,
    pub crlf: bool,
    pub encoding: String,
    pub revision: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub content: Content,
    pub left: DiffSide,
    pub right: DiffSide,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffTarget {
    pub file: String,
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Area {
    Staged,
    Unstaged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stamp {
    head: Option<String>,
    worktree: Option<(u64, u128)>,
    submodule: Option<String>,
    index: Option<u128>,
}

pub fn stamp(
    repo: &gix::Repository,
    root: &Path,
    target: &DiffTarget,
    base: Option<gix::ObjectId>,
    area: Option<Area>,
) -> Stamp {
    let full = root.join(&target.file);
    let meta = std::fs::symlink_metadata(&full).ok();
    let worktree = meta.as_ref().map(|meta| (meta.len(), modified(meta)));
    let submodule = meta
        .filter(|meta| meta.is_dir())
        .and_then(|_| gix::open(&full).ok())
        .and_then(|sub| sub.head_id().ok().map(|id| id.to_string()));
    Stamp {
        head: base
            .map(|id| id.to_string())
            .or_else(|| repo.head_id().ok().map(|id| id.to_string())),
        worktree,
        submodule,
        index: area.and_then(|_| {
            std::fs::metadata(repo.index_path())
                .ok()
                .map(|meta| modified(&meta))
        }),
    }
}

fn modified(meta: &std::fs::Metadata) -> u128 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_nanos())
        .unwrap_or_default()
}

enum Read {
    Missing,
    TooLarge,
    Bytes(Vec<u8>),
}

impl Read {
    fn bytes(&self) -> Option<&[u8]> {
        match self {
            Read::Bytes(bytes) => Some(bytes),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Source {
    Head,
    Index,
    Worktree,
    Tree {
        id: gix::ObjectId,
        revision: Option<String>,
    },
}

pub fn changes_diff(
    repo: &gix::Repository,
    root: &Path,
    base: Option<gix::ObjectId>,
    area: Option<Area>,
    target: &DiffTarget,
    options: Options,
) -> Result<FileDiff> {
    let base = match base {
        Some(id) => Source::Tree {
            id: repo
                .find_commit(id)
                .map_err(git_error)?
                .tree_id()
                .map_err(git_error)?
                .detach(),
            revision: Some(id.to_hex_with_len(8).to_string()),
        },
        None => Source::Head,
    };
    match area {
        None => compare_sources(repo, root, &base, &Source::Worktree, target, options),
        Some(Area::Staged) => compare_sources(repo, root, &base, &Source::Index, target, options),
        Some(Area::Unstaged) => {
            let staged = DiffTarget {
                file: target.file.clone(),
                old_path: None,
            };
            compare_sources(
                repo,
                root,
                &Source::Index,
                &Source::Worktree,
                &staged,
                options,
            )
        }
    }
}

pub fn compare_sources(
    repo: &gix::Repository,
    root: &Path,
    left_source: &Source,
    right_source: &Source,
    target: &DiffTarget,
    options: Options,
) -> Result<FileDiff> {
    let left_path = target.old_path.as_deref().unwrap_or(&target.file);
    let left = read(repo, root, left_source, left_path)?;
    let right = read(repo, root, right_source, &target.file)?;
    let image = is_image(&target.file) || target.old_path.as_deref().is_some_and(is_image);
    let content = if image {
        Content::Image
    } else if [&left, &right]
        .iter()
        .any(|read| matches!(read, Read::TooLarge))
    {
        Content::TooLarge
    } else if [&left, &right]
        .iter()
        .filter_map(|read| read.bytes())
        .any(is_binary)
    {
        Content::Binary
    } else {
        Content::Text
    };
    let text = content == Content::Text;
    let left_side = side(&left, left_source, repo, text);
    let right_side = side(&right, right_source, repo, text);
    let blocks = if text {
        compare_with(&left_side.text, &right_side.text, options)
    } else {
        Vec::new()
    };
    Ok(FileDiff {
        path: target.file.clone(),
        old_path: target.old_path.clone(),
        content,
        left: left_side,
        right: right_side,
        blocks,
    })
}

fn read(repo: &gix::Repository, root: &Path, source: &Source, path: &str) -> Result<Read> {
    match source {
        Source::Worktree => read_worktree(repo, root, path),
        Source::Index => read_index(repo, path),
        Source::Head => {
            if repo.head_id().is_err() {
                return Ok(Read::Missing);
            }
            let tree = repo.head_tree().map_err(git_error)?;
            read_tree(repo, &tree, path)
        }
        Source::Tree { id, .. } => {
            let tree = repo.find_tree(*id).map_err(git_error)?;
            read_tree(repo, &tree, path)
        }
    }
}

fn labels(repo: &gix::Repository, source: &Source) -> (Option<String>, Option<String>) {
    match source {
        Source::Worktree => (None, None),
        Source::Index => (None, Some("Staged version".to_string())),
        Source::Head => (
            repo.head_id()
                .ok()
                .map(|head| head.to_hex_with_len(8).to_string()),
            None,
        ),
        Source::Tree { revision, .. } => (revision.clone(), None),
    }
}

pub fn worktree_size(root: &Path, path: &str) -> Option<u64> {
    std::fs::symlink_metadata(root.join(path))
        .ok()
        .map(|meta| meta.len())
}

fn read_tree(repo: &gix::Repository, tree: &gix::Tree<'_>, path: &str) -> Result<Read> {
    let Some(entry) = tree.lookup_entry_by_path(path).map_err(git_error)? else {
        return Ok(Read::Missing);
    };
    if entry.mode().is_commit() {
        let text = format!("Subproject commit {}\n", entry.object_id());
        return Ok(Read::Bytes(text.into_bytes()));
    }
    let size = repo
        .find_header(entry.object_id())
        .map_err(git_error)?
        .size();
    if size as usize > SIZE_LIMIT {
        return Ok(Read::TooLarge);
    }
    let object = entry.object().map_err(git_error)?;
    Ok(Read::Bytes(object.detach().data))
}

fn read_index(repo: &gix::Repository, path: &str) -> Result<Read> {
    let index = repo.index_or_empty().map_err(git_error)?;
    let Some(entry) = index.entry_by_path(path.as_bytes().as_bstr()) else {
        return Ok(Read::Missing);
    };
    if entry.mode == gix::index::entry::Mode::COMMIT {
        let text = format!("Subproject commit {}\n", entry.id);
        return Ok(Read::Bytes(text.into_bytes()));
    }
    let size = repo.find_header(entry.id).map_err(git_error)?.size();
    if size as usize > SIZE_LIMIT {
        return Ok(Read::TooLarge);
    }
    let object = repo.find_object(entry.id).map_err(git_error)?;
    Ok(Read::Bytes(object.detach().data))
}

fn read_worktree(repo: &gix::Repository, root: &Path, path: &str) -> Result<Read> {
    let full = root.join(path);
    let Ok(meta) = std::fs::symlink_metadata(&full) else {
        return Ok(Read::Missing);
    };
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full)?;
        return Ok(Read::Bytes(
            target.to_string_lossy().into_owned().into_bytes(),
        ));
    }
    if meta.is_dir() {
        let head = gix::open(&full)
            .ok()
            .and_then(|sub| sub.head_id().ok().map(|id| id.to_string()));
        return Ok(match head {
            Some(id) => Read::Bytes(format!("Subproject commit {id}\n").into_bytes()),
            None => Read::Missing,
        });
    }
    if meta.len() as usize > SIZE_LIMIT {
        return Ok(Read::TooLarge);
    }
    let bytes = std::fs::read(&full)?;
    if is_binary(&bytes) {
        return Ok(Read::Bytes(bytes));
    }
    Ok(Read::Bytes(to_git(repo, path, bytes)))
}

pub fn to_git(repo: &gix::Repository, path: &str, bytes: Vec<u8>) -> Vec<u8> {
    let Ok((mut pipeline, index)) = repo.filter_pipeline(None) else {
        return bytes;
    };
    let Ok(mut converted) =
        pipeline.convert_to_git(std::io::Cursor::new(&bytes), Path::new(path), &index)
    else {
        return bytes;
    };
    if !converted.is_changed() {
        return bytes;
    }
    let mut out = Vec::with_capacity(bytes.len());
    if std::io::Read::read_to_end(&mut converted, &mut out).is_ok() {
        out
    } else {
        bytes
    }
}

pub fn to_worktree(repo: &gix::Repository, path: &str, bytes: Vec<u8>) -> Vec<u8> {
    let Ok((mut pipeline, _)) = repo.filter_pipeline(None) else {
        return bytes;
    };
    let Ok(mut converted) = pipeline.convert_to_worktree(
        &bytes,
        path.as_bytes().as_bstr(),
        gix::filter::plumbing::pipeline::convert::to_worktree::Options::default(),
    ) else {
        return bytes;
    };
    if !converted.is_changed() || converted.is_delayed() {
        return bytes;
    }
    let mut out = Vec::with_capacity(bytes.len());
    if std::io::Read::read_to_end(&mut converted, &mut out).is_ok() {
        out
    } else {
        bytes
    }
}

fn side(read: &Read, source: &Source, repo: &gix::Repository, text: bool) -> DiffSide {
    let (revision, title) = labels(repo, source);
    let bytes = read.bytes().filter(|_| text);
    let (raw, encoding) = match bytes.map(std::str::from_utf8) {
        None => (String::new(), "UTF-8"),
        Some(Ok(text)) => (text.to_string(), "UTF-8"),
        Some(Err(_)) => (
            bytes
                .unwrap_or_default()
                .iter()
                .map(|&b| b as char)
                .collect(),
            "ISO-8859-1",
        ),
    };
    let crlf = raw.contains("\r\n");
    let text = if crlf { raw.replace("\r\n", "\n") } else { raw };
    DiffSide {
        text,
        exists: !matches!(read, Read::Missing),
        crlf,
        encoding: encoding.to_string(),
        revision,
        title,
    }
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_PROBE)].contains(&0)
}

fn is_image(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn git_error(error: impl std::fmt::Display) -> Error {
    Error::Git(error.to_string())
}
