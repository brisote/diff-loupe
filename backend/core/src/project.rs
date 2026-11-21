use crate::api::{ProjectEntry, ProjectFile, SymbolMatch, SymbolSearchResult};
use crate::error::{Error, Result};
use crate::filediff::{self, Content};
use crate::platform;
use crate::shellenv::ShellEnv;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

const SEARCH_FILE_LIMIT: u64 = 2 * 1024 * 1024;
const SEARCH_TOTAL_BYTES_LIMIT: u64 = 32 * 1024 * 1024;
const SEARCH_RAW_MATCH_LIMIT: usize = 1000;
const SEARCH_MATCH_LIMIT: usize = 200;
const SEARCH_TIME_LIMIT: Duration = Duration::from_millis(1500);
const PREVIEW_LIMIT: usize = 160;

pub fn list_dir(env: &ShellEnv, root: &Path, dir: &str) -> Result<Vec<ProjectEntry>> {
    let rel = validate_relative(dir, true)?;
    let target = resolve_inside(root, &rel)?;
    if !target.is_dir() {
        return Err(Error::NotFound(format!("'{dir}' is not a directory")));
    }
    let prefix = rel_to_slash(&rel);
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&target)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.eq_ignore_ascii_case(".git") {
            continue;
        }
        let item_path = item.path();
        let file_type = item.file_type()?;
        let is_dir = if file_type.is_symlink() {
            platform::canonicalize(&item_path)
                .ok()
                .filter(|real| {
                    real.starts_with(root) && !real.strip_prefix(root).is_ok_and(has_git_component)
                })
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
        return Err(Error::NotFound(format!("'{file}' is not a file")));
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
    if size > filediff::SIZE_LIMIT as u64 {
        return Ok(ProjectFile {
            path,
            content: Content::TooLarge,
            text: String::new(),
            crlf: false,
            encoding: "UTF-8".to_string(),
            size,
        });
    }
    let handle = std::fs::File::open(&target)?;
    let mut bytes = Vec::with_capacity(size.min(filediff::SIZE_LIMIT as u64) as usize);
    handle
        .take((filediff::SIZE_LIMIT as u64) + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > filediff::SIZE_LIMIT {
        return Ok(ProjectFile {
            path,
            content: Content::TooLarge,
            text: String::new(),
            crlf: false,
            encoding: "UTF-8".to_string(),
            size: bytes.len() as u64,
        });
    }
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

pub fn search_symbol(
    env: &ShellEnv,
    root: &Path,
    symbol: &str,
    current_file: Option<&str>,
    current_line: Option<u32>,
) -> Result<SymbolSearchResult> {
    let symbol = symbol.trim();
    if symbol.is_empty() || !symbol.bytes().all(is_ident_byte) {
        return Err(Error::InvalidArgs("invalid symbol name".into()));
    }
    let files = list_searchable_files(env, root)?;
    let current_normalized = current_file.map(|f| f.replace('\\', "/"));
    let started = Instant::now();
    let mut scanned_bytes: u64 = 0;
    let mut truncated = false;
    let mut matches = Vec::new();
    for rel in files {
        if started.elapsed() >= SEARCH_TIME_LIMIT
            || scanned_bytes >= SEARCH_TOTAL_BYTES_LIMIT
            || matches.len() >= SEARCH_RAW_MATCH_LIMIT
        {
            truncated = true;
            break;
        }
        let Ok(rel_path) = validate_relative(&rel, false) else {
            continue;
        };
        let Ok(target) = resolve_inside(root, &rel_path) else {
            continue;
        };
        let Ok(meta) = std::fs::metadata(&target) else {
            continue;
        };
        if !meta.is_file() || meta.len() > SEARCH_FILE_LIMIT || filediff::is_image(&rel) {
            continue;
        }
        let Ok(handle) = std::fs::File::open(&target) else {
            continue;
        };
        let mut bytes = Vec::new();
        let mut limited = handle.take(SEARCH_FILE_LIMIT + 1);
        if limited.by_ref().take(8192).read_to_end(&mut bytes).is_err() {
            continue;
        }
        if filediff::is_binary(&bytes) {
            scanned_bytes = scanned_bytes.saturating_add(bytes.len() as u64);
            continue;
        }
        if limited.read_to_end(&mut bytes).is_err() {
            continue;
        }
        scanned_bytes = scanned_bytes.saturating_add(bytes.len() as u64);
        if bytes.len() as u64 > SEARCH_FILE_LIMIT {
            continue;
        }
        let Ok(text) = std::str::from_utf8(&bytes) else {
            continue;
        };
        let is_current_file = current_normalized.as_deref() == Some(rel.as_str());
        for (idx, raw_line) in text.lines().enumerate() {
            let line_num = (idx + 1) as u32;
            if is_current_file && current_line == Some(line_num) {
                continue;
            }
            if let Some(col) = find_whole_word(raw_line, symbol) {
                let preview: String = raw_line.trim().chars().take(PREVIEW_LIMIT).collect();
                let char_col = raw_line[..col].chars().count() as u32 + 1;
                matches.push(SymbolMatch {
                    file: rel.clone(),
                    line: line_num,
                    column: char_col,
                    preview,
                    is_declaration: is_declaration_line(raw_line, symbol),
                });
                if matches.len() >= SEARCH_RAW_MATCH_LIMIT {
                    truncated = true;
                    break;
                }
            }
        }
    }
    matches.sort_by(|a, b| {
        b.is_declaration
            .cmp(&a.is_declaration)
            .then_with(|| a.file.cmp(&b.file))
            .then_with(|| a.line.cmp(&b.line))
    });
    if matches.len() > SEARCH_MATCH_LIMIT {
        truncated = true;
        matches.truncate(SEARCH_MATCH_LIMIT);
    }
    Ok(SymbolSearchResult {
        symbol: symbol.to_string(),
        matches,
        truncated,
    })
}

fn list_searchable_files(env: &ShellEnv, root: &Path) -> Result<Vec<String>> {
    let mut cmd = env.git(root);
    cmd.args([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let output = cmd
        .output()
        .map_err(|err| Error::Git(format!("failed to run git ls-files: {err}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(Error::Git(if stderr.is_empty() {
            "git ls-files failed".to_string()
        } else {
            stderr
        }));
    }
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for slice in output.stdout.split(|&b| b == 0) {
        if slice.is_empty() {
            continue;
        }
        let path = String::from_utf8_lossy(slice).replace('\\', "/");
        if seen.insert(path.clone()) {
            files.push(path);
        }
    }
    Ok(files)
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn find_whole_word(line: &str, symbol: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let sym_len = symbol.len();
    let mut start = 0;
    while let Some(offset) = line[start..].find(symbol) {
        let pos = start + offset;
        let before_ok = pos == 0 || !is_ident_byte(bytes[pos - 1]);
        let after_pos = pos + sym_len;
        let after_ok = after_pos >= bytes.len() || !is_ident_byte(bytes[after_pos]);
        if before_ok && after_ok {
            return Some(pos);
        }
        start = pos + 1;
    }
    None
}

fn is_declaration_line(line: &str, symbol: &str) -> bool {
    let trimmed = line.trim();
    let prefixes = [
        "fn ",
        "fun ",
        "func ",
        "def ",
        "function ",
        "class ",
        "interface ",
        "struct ",
        "enum ",
        "trait ",
        "type ",
        "const ",
        "let ",
        "var ",
        "val ",
    ];
    for kw in prefixes {
        let pattern = format!("{kw}{symbol}");
        if let Some(idx) = trimmed.find(&pattern) {
            let after = idx + pattern.len();
            let before_ok = idx == 0 || !is_ident_byte(trimmed.as_bytes()[idx - 1]);
            let after_ok = after >= trimmed.len() || !is_ident_byte(trimmed.as_bytes()[after]);
            if before_ok && after_ok {
                return true;
            }
        }
    }
    let modifiers = ["public ", "private ", "protected "];
    if modifiers.iter().any(|m| trimmed.starts_with(m)) && !trimmed.ends_with(';') {
        let call = format!("{symbol}(");
        let mut start = 0;
        while let Some(offset) = trimmed[start..].find(&call) {
            let pos = start + offset;
            if pos == 0 || !is_ident_byte(trimmed.as_bytes()[pos - 1]) {
                return true;
            }
            start = pos + 1;
        }
    }
    false
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
    let stdin = child.stdin.take();
    let output = std::thread::scope(|scope| {
        if let Some(mut stdin) = stdin {
            scope.spawn(move || {
                for entry in entries {
                    if stdin.write_all(entry.path.as_bytes()).is_err()
                        || stdin.write_all(b"\0").is_err()
                    {
                        break;
                    }
                }
            });
        }
        child.wait_with_output()
    });
    let Ok(output) = output else {
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

fn validate_relative(raw: &str, allow_empty: bool) -> Result<PathBuf> {
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
    if has_git_component(path) {
        return Err(Error::InvalidArgs(format!("{raw} is inside .git")));
    }
    Ok(path.to_path_buf())
}

fn has_git_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(part) => part
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(".git")),
        _ => false,
    })
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
        return Err(Error::GitRefused(format!(
            "{} points outside the repository",
            relative.display()
        )));
    }
    if canonical.strip_prefix(root).is_ok_and(has_git_component) {
        return Err(Error::GitRefused(format!(
            "{} points inside .git",
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
        assert!(validate_relative(".git", true).is_err());
        assert!(validate_relative(".git/config", false).is_err());
        assert!(validate_relative(".GIT/HEAD", false).is_err());
        assert!(validate_relative("sub/.git/config", false).is_err());
        assert!(validate_relative(".gitignore", false).is_ok());
        assert!(validate_relative(".github/workflows/ci.yml", false).is_ok());
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

    #[test]
    fn matches_whole_words_and_ranks_declarations() {
        assert_eq!(find_whole_word("fooBar foo_1 foo()", "foo"), Some(13));
        assert_eq!(find_whole_word("foobar", "foo"), None);
        assert!(is_declaration_line(
            "pub fn getLatestObservation(id: u64) {",
            "getLatestObservation"
        ));
        assert!(is_declaration_line(
            "public Optional<Obs> getLatestObservation(long id)",
            "getLatestObservation"
        ));
        assert!(!is_declaration_line(
            "let x = svc.getLatestObservation(id);",
            "getLatestObservation"
        ));
        assert!(!is_declaration_line("public void fooBar() {", "Bar"));
        assert!(is_declaration_line("public void Bar() {", "Bar"));
    }
}
