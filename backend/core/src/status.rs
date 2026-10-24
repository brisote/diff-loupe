use crate::error::{Error, Result};
use crate::shellenv::ShellEnv;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileChange {
    pub path: String,
    pub old_path: Option<String>,
    pub head_path: Option<String>,
    pub kind: ChangeKind,
    pub staged: bool,
    pub unstaged: bool,
    pub unchanged: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Untracked {
    #[default]
    All,
    Skip,
}

pub fn read(env: &ShellEnv, root: &Path, untracked: Untracked) -> Result<Vec<FileChange>> {
    let output = env
        .git(root)
        .args([
            "status",
            "--porcelain=v2",
            "-z",
            match untracked {
                Untracked::All => "--untracked-files=all",
                Untracked::Skip => "--untracked-files=no",
            },
            "--find-renames",
        ])
        .output()?;
    if !output.status.success() {
        return Err(Error::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(parse(&String::from_utf8_lossy(&output.stdout)))
}

pub fn parse(raw: &str) -> Vec<FileChange> {
    let mut records = raw.split('\0').filter(|record| !record.is_empty());
    let mut changes = Vec::new();
    while let Some(record) = records.next() {
        let change = match record.as_bytes().first() {
            Some(b'1') => ordinary(record),
            Some(b'2') => renamed(record, records.next()),
            Some(b'u') => unmerged(record),
            Some(b'?') => record.get(2..).map(|path| FileChange {
                path: path.to_string(),
                old_path: None,
                head_path: None,
                kind: ChangeKind::Untracked,
                staged: false,
                unstaged: true,
                unchanged: false,
            }),
            _ => None,
        };
        changes.extend(change);
    }
    changes
}

pub fn against(
    env: &ShellEnv,
    root: &Path,
    base: &str,
    untracked: Untracked,
) -> Result<Vec<FileChange>> {
    let diff = env
        .git(root)
        .args(["diff", "--name-status", "-z", "--find-renames", base, "--"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let local = read(env, root, untracked);
    let output = diff.wait_with_output()?;
    let local = local?;
    if !output.status.success() {
        return Err(Error::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(combine(
        committed(&String::from_utf8_lossy(&output.stdout)),
        local,
    ))
}

pub fn committed(raw: &str) -> Vec<FileChange> {
    let mut fields = raw.split('\0').filter(|field| !field.is_empty());
    let mut changes = Vec::new();
    while let Some(status) = fields.next() {
        let renamed = status.starts_with('R') || status.starts_with('C');
        let old_path = if renamed { fields.next() } else { None };
        let Some(path) = fields.next() else { break };
        let kind = match status.chars().next() {
            Some('A') => ChangeKind::Added,
            Some('D') => ChangeKind::Deleted,
            Some('R') => ChangeKind::Renamed,
            Some('C') => ChangeKind::Copied,
            Some('T') => ChangeKind::TypeChanged,
            Some('U') => continue,
            _ => ChangeKind::Modified,
        };
        changes.push(FileChange {
            path: path.to_string(),
            old_path: old_path.map(str::to_string),
            head_path: None,
            kind,
            staged: false,
            unstaged: false,
            unchanged: false,
        });
    }
    changes
}

pub fn combine(committed: Vec<FileChange>, local: Vec<FileChange>) -> Vec<FileChange> {
    let mut changes = committed;
    let mut index: HashMap<String, usize> = changes
        .iter()
        .enumerate()
        .map(|(at, change)| (change.path.clone(), at))
        .collect();
    for change in local {
        let tracked = !matches!(change.kind, ChangeKind::Untracked | ChangeKind::Conflicted);
        match index.get(&change.path).copied() {
            Some(at) if tracked => {
                let known = &mut changes[at];
                known.head_path = change.head_path;
                known.staged = change.staged;
                known.unstaged = change.unstaged;
            }
            Some(at) => changes[at] = change,
            None => {
                index.insert(change.path.clone(), changes.len());
                changes.push(FileChange {
                    unchanged: tracked,
                    ..change
                });
            }
        }
    }
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    changes
}

fn flags(xy: &str) -> (char, char) {
    let mut chars = xy.chars();
    (chars.next().unwrap_or('.'), chars.next().unwrap_or('.'))
}

fn ordinary(record: &str) -> Option<FileChange> {
    let fields: Vec<&str> = record.splitn(9, ' ').collect();
    let (x, y) = flags(fields.get(1)?);
    let kind = if x == 'A' || y == 'A' {
        ChangeKind::Added
    } else if x == 'D' || y == 'D' {
        ChangeKind::Deleted
    } else if x == 'T' || y == 'T' {
        ChangeKind::TypeChanged
    } else {
        ChangeKind::Modified
    };
    Some(FileChange {
        path: fields.get(8)?.to_string(),
        old_path: None,
        head_path: None,
        kind,
        staged: x != '.',
        unstaged: y != '.',
        unchanged: false,
    })
}

fn renamed(record: &str, original: Option<&str>) -> Option<FileChange> {
    let fields: Vec<&str> = record.splitn(10, ' ').collect();
    let (x, y) = flags(fields.get(1)?);
    let kind = if fields.get(8)?.starts_with('C') {
        ChangeKind::Copied
    } else {
        ChangeKind::Renamed
    };
    Some(FileChange {
        path: fields.get(9)?.to_string(),
        old_path: original.map(str::to_string),
        head_path: original.map(str::to_string),
        kind,
        staged: x != '.',
        unstaged: y != '.',
        unchanged: false,
    })
}

fn unmerged(record: &str) -> Option<FileChange> {
    let fields: Vec<&str> = record.splitn(11, ' ').collect();
    Some(FileChange {
        path: fields.get(10)?.to_string(),
        old_path: None,
        head_path: None,
        kind: ChangeKind::Conflicted,
        staged: false,
        unstaged: true,
        unchanged: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "1111111111111111111111111111111111111111";

    fn ordinary_record(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 {HASH} {HASH} {path}")
    }

    #[test]
    fn ordinary_entries_keep_their_kind_and_flags() {
        let raw = [
            ordinary_record(".M", "src/Main.kt"),
            ordinary_record("A.", "new file.txt"),
            ordinary_record("MD", "gone.txt"),
            ordinary_record(".A", "intent.txt"),
            ordinary_record("T.", "link"),
        ]
        .join("\0");
        let changes = parse(&raw);
        let kinds: Vec<_> = changes.iter().map(|c| (c.path.as_str(), c.kind)).collect();
        assert_eq!(
            kinds,
            [
                ("src/Main.kt", ChangeKind::Modified),
                ("new file.txt", ChangeKind::Added),
                ("gone.txt", ChangeKind::Deleted),
                ("intent.txt", ChangeKind::Added),
                ("link", ChangeKind::TypeChanged),
            ]
        );
        assert!(!changes[0].staged && changes[0].unstaged);
        assert!(changes[1].staged && !changes[1].unstaged);
    }

    #[test]
    fn renames_read_the_original_path_from_the_next_record() {
        let raw = format!(
            "2 R. N... 100644 100644 100644 {HASH} {HASH} R100 docs/new name.md\0docs/old name.md\0? notes.txt\0"
        );
        let changes = parse(&raw);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].kind, ChangeKind::Renamed);
        assert_eq!(changes[0].path, "docs/new name.md");
        assert_eq!(changes[0].old_path.as_deref(), Some("docs/old name.md"));
        assert_eq!(changes[1].kind, ChangeKind::Untracked);
    }

    #[test]
    fn branch_changes_and_local_edits_combine_by_path() {
        let raw = "M\0billing/Totals.kt\0R092\0old/Csv.kt\0csv/Csv.kt\0A\0notes.md\0D\0gone.kt\0U\0both.kt\0";
        let local = parse(&format!(
            "{}\0{}\0? draft.txt\0u UU N... 100644 100644 100644 100644 {HASH} {HASH} {HASH} both.kt\0",
            ordinary_record(".M", "notes.md"),
            ordinary_record(".M", "README.md"),
        ));
        let changes = combine(committed(raw), local);
        let summary: Vec<_> = changes
            .iter()
            .map(|c| {
                (
                    c.path.as_str(),
                    c.kind,
                    c.old_path.as_deref(),
                    c.staged || c.unstaged,
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("README.md", ChangeKind::Modified, None, true),
                ("billing/Totals.kt", ChangeKind::Modified, None, false),
                ("both.kt", ChangeKind::Conflicted, None, true),
                ("csv/Csv.kt", ChangeKind::Renamed, Some("old/Csv.kt"), false),
                ("draft.txt", ChangeKind::Untracked, None, true),
                ("gone.kt", ChangeKind::Deleted, None, false),
                ("notes.md", ChangeKind::Added, None, true),
            ]
        );
        let unchanged: Vec<_> = changes
            .iter()
            .filter(|c| c.unchanged)
            .map(|c| c.path.as_str())
            .collect();
        assert_eq!(unchanged, ["README.md"]);
    }

    #[test]
    fn a_local_rename_keeps_its_head_path_for_the_commit() {
        let raw = "R090\0a/Old.kt\0c/New.kt\0";
        let local = parse(&format!(
            "2 R. N... 100644 100644 100644 {HASH} {HASH} R100 c/New.kt\0b/Mid.kt\0"
        ));
        let changes = combine(committed(raw), local);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].old_path.as_deref(), Some("a/Old.kt"));
        assert_eq!(changes[0].head_path.as_deref(), Some("b/Mid.kt"));
        assert!(changes[0].staged);
    }

    #[test]
    fn conflicts_and_headers_are_read_or_skipped() {
        let raw = format!(
            "# branch.oid {HASH}\0u UU N... 100644 100644 100644 100644 {HASH} {HASH} {HASH} a b.txt\0! ignored.log\0"
        );
        let changes = parse(&raw);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Conflicted);
        assert_eq!(changes[0].path, "a b.txt");
    }
}
