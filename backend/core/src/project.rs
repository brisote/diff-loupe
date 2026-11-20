use crate::api::{ProjectEntry, ProjectFile};
use crate::error::{Error, Result};
use crate::filediff::{self, Content};
use crate::platform;
use crate::shellenv::ShellEnv;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

pub fn list_dir(env: &ShellEnv, root: &Path, dir: &str) -> Result<Vec<ProjectEntry>> {
    let rel = validate_relative(dir, true)?;
    let target = resolve_inside(root, &rel)?;
    if !target.is_dir() {
        return Err(Error::InvalidArgs(format!("{dir} is not a directory")));
    }
    let prefix = rel_to_slash(&rel);
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&target)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let item_path = item.path();
        let file_type = item.file_type()?;
        let is_dir = if file_type.is_symlink() {
            platform::canonicalize(&item_path)
                .ok()
                .filter(|real| real.starts_with(root))
                .is_some_and(|real| real.is_dir())
        } else {
            file_type.is_dir()
        };
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        entries.push(ProjectEntry {
            name,
            path,
            is_dir,
            ignored: false,
        });
    }
    let ignored = check_ignored(env, root, &entries);
    for entry in &mut entries {
        entry.ignored = ignored.contains(&entry.path);
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
            })
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

pub fn read_file(root: &Path, file: &str) -> Result<ProjectFile> {
    let rel = validate_relative(file, false)?;
    let target = resolve_inside(root, &rel)?;
    let meta = std::fs::metadata(&target)?;
    if !meta.is_file() {
        return Err(Error::InvalidArgs(format!("{file} is not a file")));
    }
    let size = meta.len();
    let path = rel_to_slash(&rel);
    if filediff::is_image(&path) {
        return Ok(ProjectFile {
            path,
            content: Content::Image,
            text: String::new(),
            crlf: false,
            encoding: "UTF-8".to_string(),
            size,
        });
    }
    if size as usize > filediff::SIZE_LIMIT {
        return Ok(ProjectFile {
            path,
            content: Content::TooLarge,
            text: String::new(),
            crlf: false,
            encoding: "UTF-8".to_string(),
            size,
        });
    }
    let bytes = std::fs::read(&target)?;
    if filediff::is_binary(&bytes) {
        return Ok(ProjectFile {
            path,
            content: Content::Binary,
            text: String::new(),
            crlf: false,
            encoding: "UTF-8".to_string(),
            size,
        });
    }
    let (raw, encoding) = match std::str::from_utf8(&bytes) {
        Ok(text) => (text.to_string(), "UTF-8"),
        Err(_) => (bytes.iter().map(|&b| b as char).collect(), "ISO-8859-1"),
    };
    let crlf = raw.contains("\r\n");
    let text = if crlf { raw.replace("\r\n", "\n") } else { raw };
    Ok(ProjectFile {
        path,
        content: Content::Text,
        text,
        crlf,
        encoding: encoding.to_string(),
        size,
    })
}

fn check_ignored(env: &ShellEnv, root: &Path, entries: &[ProjectEntry]) -> HashSet<String> {
    if entries.is_empty() {
        return HashSet::new();
    }
    let mut cmd = env.git(root);
    cmd.args(["check-ignore", "--stdin", "-z"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let Ok(mut child) = cmd.spawn() else {
        return HashSet::new();
    };
    if let Some(mut stdin) = child.stdin.take() {
        for entry in entries {
            let _ = stdin.write_all(entry.path.as_bytes());
            let _ = stdin.write_all(b"\0");
        }
    }
    let Ok(output) = child.wait_with_output() else {
        return HashSet::new();
    };
    output
        .stdout
        .split(|&b| b == 0)
        .filter(|slice| !slice.is_empty())
        .map(|slice| {
            String::from_utf8_lossy(slice)
                .trim_end_matches('/')
                .to_string()
        })
        .collect()
}

pub(crate) fn validate_relative(raw: &str, allow_empty: bool) -> Result<PathBuf> {
    let normalized = raw.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.is_empty() {
        if allow_empty {
            return Ok(PathBuf::new());
        }
        return Err(Error::InvalidArgs("file path is empty".into()));
    }
    let path = Path::new(trimmed);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(Error::InvalidArgs(format!(
            "{raw} is outside the repository"
        )));
    }
    Ok(path.to_path_buf())
}

fn resolve_inside(root: &Path, relative: &Path) -> Result<PathBuf> {
    let target = if relative.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    if !target.exists() {
        return Err(Error::NotFound(relative.display().to_string()));
    }
    let canonical = platform::canonicalize(&target)?;
    if !canonical.starts_with(root) {
        return Err(Error::InvalidArgs(format!(
            "{} is outside the repository",
            relative.display()
        )));
    }
    Ok(canonical)
}

fn rel_to_slash(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn rejects_path_traversal_and_absolute_paths() {
        assert!(validate_relative("../secret", false).is_err());
        assert!(validate_relative("a/../../b", true).is_err());
        assert!(validate_relative("/etc/passwd", false).is_err());
        assert!(validate_relative("", false).is_err());
        assert!(validate_relative("", true).is_ok());
    }

    #[test]
    fn sorts_directories_first_case_insensitively_and_hides_git() {
        let dir = tempdir().unwrap();
        let root = platform::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::create_dir(root.join("Zebra")).unwrap();
        std::fs::create_dir(root.join("alpha")).unwrap();
        std::fs::write(root.join("README.md"), "# hi\n").unwrap();
        std::fs::write(root.join("a.txt"), "hello\n").unwrap();
        let env = ShellEnv::from_path("");
        let entries = list_dir(&env, &root, "").unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Zebra", "a.txt", "README.md"]);
        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert!(!entries[2].is_dir);
    }

    #[test]
    fn classifies_text_binary_and_image_files() {
        let dir = tempdir().unwrap();
        let root = platform::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("note.txt"), "a\r\nb\r\n").unwrap();
        std::fs::write(root.join("bin.dat"), [0u8, 1, 2, 3]).unwrap();
        std::fs::write(root.join("pic.png"), [137u8, 80, 78, 71]).unwrap();

        let text = read_file(&root, "note.txt").unwrap();
        assert_eq!(text.content, Content::Text);
        assert!(text.crlf);
        assert_eq!(text.text, "a\nb\n");

        let bin = read_file(&root, "bin.dat").unwrap();
        assert_eq!(bin.content, Content::Binary);
        assert!(bin.text.is_empty());

        let img = read_file(&root, "pic.png").unwrap();
        assert_eq!(img.content, Content::Image);
        assert!(img.text.is_empty());
    }
}
