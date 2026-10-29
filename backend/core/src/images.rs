use crate::error::{Error, Result};
use crate::platform;
use std::path::{Component, Path, PathBuf};

const IMAGE_LIMIT: u64 = 10 * 1024 * 1024;
const TYPES: [(&str, &str); 8] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
];

pub fn resolve(document: &str, source: &str) -> Option<String> {
    let source = source.split(['?', '#']).next()?;
    if source.is_empty() || source.contains(':') || source.starts_with("//") {
        return None;
    }
    let decoded = percent_decode(source)?;
    let base = if decoded.starts_with('/') {
        PathBuf::new()
    } else {
        Path::new(document).parent()?.to_path_buf()
    };
    let mut parts: Vec<String> = Vec::new();
    for component in base.join(decoded.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::ParentDir => {
                parts.pop()?;
            }
            Component::CurDir | Component::RootDir => {}
            Component::Prefix(_) => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn media_type(path: &str) -> Option<&'static str> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    TYPES
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|(_, media)| *media)
}

pub fn read(
    repo: &gix::Repository,
    root: &Path,
    rev: Option<&str>,
    path: &str,
) -> Result<Option<String>> {
    let Some(media) = media_type(path) else {
        return Ok(None);
    };
    let bytes = match rev {
        None => {
            let full = root.join(path);
            let Ok(meta) = std::fs::metadata(&full) else {
                return Ok(None);
            };
            let inside = platform::canonicalize(&full).is_ok_and(|real| real.starts_with(root));
            if !meta.is_file() || !inside || meta.len() > IMAGE_LIMIT {
                return Ok(None);
            }
            std::fs::read(full)?
        }
        Some(rev) => {
            let Ok(object) = repo.rev_parse_single(format!("{rev}:{path}").as_str()) else {
                return Ok(None);
            };
            let header = repo.find_header(object.detach()).map_err(git_error)?;
            if header.size() > IMAGE_LIMIT || header.kind() != gix::object::Kind::Blob {
                return Ok(None);
            }
            object.object().map_err(git_error)?.detach().data
        }
    };
    Ok(Some(format!("data:{media};base64,{}", base64(&bytes))))
}

pub fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for (position, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if position <= chunk.len() {
                out.push(char::from(TABLE[((n >> shift) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn git_error(error: impl std::fmt::Display) -> Error {
    Error::Git(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{base64, media_type, resolve};

    #[test]
    fn relative_sources_resolve_inside_the_repository() {
        assert_eq!(
            resolve("docs/guide.md", "img/a.png").as_deref(),
            Some("docs/img/a.png")
        );
        assert_eq!(
            resolve("docs/guide.md", "../logo.png").as_deref(),
            Some("logo.png")
        );
        assert_eq!(
            resolve("docs/guide.md", "/assets/x.png?v=2").as_deref(),
            Some("assets/x.png")
        );
        assert_eq!(
            resolve("README.md", "my%20shot.png").as_deref(),
            Some("my shot.png")
        );
        assert_eq!(resolve("README.md", "../../etc/passwd"), None);
        assert_eq!(resolve("README.md", "https://example.com/a.png"), None);
        assert_eq!(resolve("README.md", "//cdn.example.com/a.png"), None);
        assert_eq!(resolve("README.md", "data:image/png;base64,AAAA"), None);
    }

    #[test]
    fn images_are_known_by_their_extension() {
        assert_eq!(media_type("a/B.PNG"), Some("image/png"));
        assert_eq!(media_type("a/notes.txt"), None);
    }

    #[test]
    fn base64_pads_like_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
