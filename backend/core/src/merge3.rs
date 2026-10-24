use crate::error::{Error, Result};
use imara_diff::{Algorithm, Diff, InternedInput};
use serde::Serialize;
use std::hash::Hash;
use std::ops::Range;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ChunkKind {
    Ours,
    Theirs,
    Same,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MergeChunk {
    pub kind: ChunkKind,
    pub base_start: u32,
    pub base_end: u32,
    pub ours_start: u32,
    pub ours_end: u32,
    pub theirs_start: u32,
    pub theirs_end: u32,
    pub combined: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    pub kind: ChunkKind,
    pub base: Range<u32>,
    pub ours: Range<u32>,
    pub theirs: Range<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum From {
    Ours,
    Theirs,
}

struct Hunk {
    from: From,
    base: Range<u32>,
    side: Range<u32>,
}

impl Hunk {
    fn growth(&self) -> i64 {
        i64::from(self.side.end - self.side.start) - i64::from(self.base.end - self.base.start)
    }
}

fn hunks<T: Hash + Eq + Copy + Default>(base: &[T], side: &[T], from: From) -> Vec<Hunk> {
    let mut input = InternedInput::default();
    input.update_before(base.iter().copied());
    input.update_after(side.iter().copied());
    let diff = Diff::compute(Algorithm::Histogram, &input);
    diff.hunks()
        .map(|hunk| Hunk {
            from,
            base: hunk.before,
            side: hunk.after,
        })
        .collect()
}

fn shift(position: u32, by: i64) -> u32 {
    u32::try_from(i64::from(position) + by).unwrap_or_default()
}

pub fn regions<T: Hash + Eq + Copy + Default>(base: &[T], ours: &[T], theirs: &[T]) -> Vec<Region> {
    let (ours_seq, theirs_seq) = (ours, theirs);
    let mut all: Vec<Hunk> = hunks(base, ours, From::Ours);
    all.extend(hunks(base, theirs, From::Theirs));
    all.sort_by_key(|hunk| (hunk.base.start, hunk.base.end));
    let mut groups: Vec<Vec<Hunk>> = Vec::new();
    let (mut end, mut sides) = (0u32, [false, false]);
    for hunk in all {
        let side = usize::from(hunk.from == From::Theirs);
        let joins = !groups.is_empty()
            && (hunk.base.start < end || (hunk.base.start == end && sides[1 - side]));
        if !joins {
            sides = [false, false];
            groups.push(Vec::new());
        }
        end = if joins {
            end.max(hunk.base.end)
        } else {
            hunk.base.end
        };
        sides[side] = true;
        if let Some(group) = groups.last_mut() {
            group.push(hunk);
        }
    }
    let mut offsets = [0i64, 0i64];
    groups
        .into_iter()
        .map(|group| {
            let start = group.iter().map(|h| h.base.start).min().unwrap_or_default();
            let end = group.iter().map(|h| h.base.end).max().unwrap_or_default();
            let range = |from: From, before: i64| {
                let growth: i64 = group
                    .iter()
                    .filter(|h| h.from == from)
                    .map(Hunk::growth)
                    .sum();
                shift(start, before)..shift(end, before + growth)
            };
            let ours = range(From::Ours, offsets[0]);
            let theirs = range(From::Theirs, offsets[1]);
            let has = |from: From| group.iter().any(|h| h.from == from);
            let kind = match (has(From::Ours), has(From::Theirs)) {
                (true, false) => ChunkKind::Ours,
                (false, true) => ChunkKind::Theirs,
                _ if ours_seq[ours.start as usize..ours.end as usize]
                    == theirs_seq[theirs.start as usize..theirs.end as usize] =>
                {
                    ChunkKind::Same
                }
                _ => ChunkKind::Conflict,
            };
            for hunk in &group {
                offsets[usize::from(hunk.from == From::Theirs)] += hunk.growth();
            }
            Region {
                kind,
                base: start..end,
                ours,
                theirs,
            }
        })
        .collect()
}

fn lines(text: &str) -> Vec<&str> {
    imara_diff::sources::lines(text).collect()
}

fn joined(lines: &[&str], range: &Range<u32>) -> String {
    lines[range.start as usize..range.end as usize].concat()
}

pub fn combine<'a>(base: &[&'a str], ours: &[&'a str], theirs: &[&'a str]) -> Option<String> {
    let found = regions(base, ours, theirs);
    if found
        .iter()
        .any(|region| region.kind == ChunkKind::Conflict)
    {
        return None;
    }
    let mut out = String::new();
    let mut at = 0usize;
    for region in &found {
        out.push_str(&base[at..region.base.start as usize].concat());
        match region.kind {
            ChunkKind::Theirs => out.push_str(
                &theirs[region.theirs.start as usize..region.theirs.end as usize].concat(),
            ),
            _ => out.push_str(&ours[region.ours.start as usize..region.ours.end as usize].concat()),
        }
        at = region.base.end as usize;
    }
    out.push_str(&base[at..].concat());
    Some(out)
}

pub fn merged(base: &str, ours: &str, theirs: &str) -> Option<String> {
    combine(&lines(base), &lines(ours), &lines(theirs))
}

fn words(text: &str) -> Vec<&str> {
    crate::diff::tokens(text)
        .into_iter()
        .map(|(_, token)| token)
        .collect()
}

pub fn chunks(base: &str, ours: &str, theirs: &str) -> Vec<MergeChunk> {
    let (base_lines, ours_lines, theirs_lines) = (lines(base), lines(ours), lines(theirs));
    regions(&base_lines, &ours_lines, &theirs_lines)
        .into_iter()
        .map(|region| {
            let combined = (region.kind == ChunkKind::Conflict)
                .then(|| {
                    let base_text = joined(&base_lines, &region.base);
                    let ours_text = joined(&ours_lines, &region.ours);
                    let theirs_text = joined(&theirs_lines, &region.theirs);
                    combine(&words(&base_text), &words(&ours_text), &words(&theirs_text))
                })
                .flatten();
            MergeChunk {
                kind: region.kind,
                base_start: region.base.start,
                base_end: region.base.end,
                ours_start: region.ours.start,
                ours_end: region.ours.end,
                theirs_start: region.theirs.start,
                theirs_end: region.theirs.end,
                combined,
            }
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MergeContent {
    Text,
    Binary,
    Link,
    Encoding,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MergeFile {
    pub path: String,
    pub content: MergeContent,
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub crlf: bool,
    pub chunks: Vec<MergeChunk>,
}

fn crlf_lines(bytes: &[u8]) -> bool {
    let lines = bytes.iter().filter(|&&byte| byte == b'\n').count();
    let crlf = bytes.windows(2).filter(|pair| pair == b"\r\n").count();
    crlf * 2 > lines
}

fn git_error(error: impl std::fmt::Display) -> Error {
    Error::Git(error.to_string())
}

pub fn read(repo: &gix::Repository, path: &str) -> Result<MergeFile> {
    use gix::index::entry::Stage;
    let index = repo.index_or_empty().map_err(git_error)?;
    let special = [Stage::Base, Stage::Ours, Stage::Theirs]
        .iter()
        .any(|stage| {
            index
                .entry_by_path_and_stage(path.into(), *stage)
                .is_some_and(|entry| {
                    matches!(
                        entry.mode,
                        gix::index::entry::Mode::SYMLINK | gix::index::entry::Mode::COMMIT
                    )
                })
        });
    let blob = |stage: Stage| -> Result<Option<Vec<u8>>> {
        index
            .entry_by_path_and_stage(path.into(), stage)
            .map(|entry| {
                repo.find_object(entry.id)
                    .map(|object| object.detach().data)
                    .map_err(git_error)
            })
            .transpose()
    };
    let (base, ours, theirs) = (blob(Stage::Base)?, blob(Stage::Ours)?, blob(Stage::Theirs)?);
    if base.is_none() && ours.is_none() && theirs.is_none() {
        return Err(Error::InvalidArgs(format!(
            "{path} has no conflict to resolve"
        )));
    }
    let file = |content: MergeContent| MergeFile {
        path: path.to_string(),
        content,
        base: String::new(),
        ours: String::new(),
        theirs: String::new(),
        crlf: false,
        chunks: Vec::new(),
    };
    let (Some(ours), Some(theirs)) = (ours, theirs) else {
        return Ok(file(MergeContent::Deleted));
    };
    let base = base.unwrap_or_default();
    let sides = [&base, &ours, &theirs];
    if special {
        return Ok(file(MergeContent::Link));
    }
    if sides.iter().any(|bytes| bytes.contains(&0)) {
        return Ok(file(MergeContent::Binary));
    }
    let Ok(texts) = sides
        .iter()
        .map(|bytes| std::str::from_utf8(bytes))
        .collect::<std::result::Result<Vec<&str>, _>>()
    else {
        return Ok(file(MergeContent::Encoding));
    };
    let disk = repo
        .workdir()
        .and_then(|root| std::fs::read(root.join(path)).ok())
        .unwrap_or_else(|| ours.clone());
    let crlf = crlf_lines(&disk);
    let [base, ours, theirs] =
        [texts[0], texts[1], texts[2]].map(|text| text.replace("\r\n", "\n"));
    Ok(MergeFile {
        chunks: chunks(&base, &ours, &theirs),
        path: path.to_string(),
        content: MergeContent::Text,
        base,
        ours,
        theirs,
        crlf,
    })
}

#[cfg(test)]
mod tests {
    use super::{ChunkKind, MergeChunk, chunks, merged};

    fn kinds(chunks: &[MergeChunk]) -> Vec<ChunkKind> {
        chunks.iter().map(|chunk| chunk.kind).collect()
    }

    #[test]
    fn edits_far_apart_merge_on_their_own() {
        let base = "a\nb\nc\nd\ne\n";
        let ours = "A\nb\nc\nd\ne\n";
        let theirs = "a\nb\nc\nd\nE\n";
        let found = chunks(base, ours, theirs);
        assert_eq!(kinds(&found), vec![ChunkKind::Ours, ChunkKind::Theirs]);
        assert_eq!((found[1].theirs_start, found[1].theirs_end), (4, 5));
        assert_eq!(
            merged(base, ours, theirs).as_deref(),
            Some("A\nb\nc\nd\nE\n")
        );
    }

    #[test]
    fn neighbouring_edits_conflict() {
        let found = chunks("a\nb\nc\n", "A\nb\nc\n", "a\nB\nc\n");
        assert_eq!(kinds(&found), vec![ChunkKind::Conflict]);
        assert_eq!((found[0].base_start, found[0].base_end), (0, 2));
        assert_eq!((found[0].ours_start, found[0].ours_end), (0, 2));
        assert_eq!((found[0].theirs_start, found[0].theirs_end), (0, 2));
    }

    #[test]
    fn the_same_change_on_both_sides_is_not_a_conflict() {
        let found = chunks("a\nb\nc\n", "a\nX\nc\n", "a\nX\nc\n");
        assert_eq!(kinds(&found), vec![ChunkKind::Same]);
    }

    #[test]
    fn overlapping_edits_conflict_and_word_edits_combine() {
        let found = chunks(
            "val total = round(sum, 2)\n",
            "val total = round(sum, 4)\n",
            "val grand = round(sum, 2)\n",
        );
        assert_eq!(kinds(&found), vec![ChunkKind::Conflict]);
        assert_eq!(
            found[0].combined.as_deref(),
            Some("val grand = round(sum, 4)\n")
        );
        let hard = chunks("x = 1\n", "x = 2\n", "x = 3\n");
        assert_eq!(hard[0].combined, None);
    }

    #[test]
    fn a_deletion_against_an_edit_conflicts() {
        let found = chunks("a\nb\nc\n", "a\nc\n", "a\nB\nc\n");
        assert_eq!(kinds(&found), vec![ChunkKind::Conflict]);
        assert_eq!((found[0].ours_start, found[0].ours_end), (1, 1));
        assert_eq!((found[0].theirs_start, found[0].theirs_end), (1, 2));
        assert_eq!(found[0].combined, None);
    }

    #[test]
    fn line_counts_shift_for_later_chunks() {
        let base = "a\nb\nc\nd\ne\nf\n";
        let ours = "new\na\nb\nc\nd\ne\nf\n";
        let theirs = "a\nb\nc\nd\ne\n";
        let found = chunks(base, ours, theirs);
        assert_eq!(kinds(&found), vec![ChunkKind::Ours, ChunkKind::Theirs]);
        assert_eq!((found[1].base_start, found[1].base_end), (5, 6));
        assert_eq!((found[1].ours_start, found[1].ours_end), (6, 7));
        assert_eq!((found[1].theirs_start, found[1].theirs_end), (5, 5));
    }

    #[test]
    fn a_missing_final_newline_is_a_change() {
        let found = chunks("a\nb\n", "a\nb", "a\nb\n");
        assert_eq!(kinds(&found), vec![ChunkKind::Ours]);
        assert_eq!(merged("a\nb\n", "a\nb", "a\nB\n"), None);
    }

    #[test]
    fn a_long_run_of_interleaved_edits_stays_fast() {
        let lines = |edit: &dyn Fn(usize) -> String| -> String {
            (0..10_000).map(|n| format!("{}\n", edit(n))).collect()
        };
        let base = lines(&|n| format!("line {n}"));
        let ours = lines(&|n| {
            if n % 2 == 0 {
                format!("ours {n}")
            } else {
                format!("line {n}")
            }
        });
        let theirs = lines(&|n| {
            if n % 2 == 1 {
                format!("theirs {n}")
            } else {
                format!("line {n}")
            }
        });
        let start = std::time::Instant::now();
        let found = chunks(&base, &ours, &theirs);
        assert_eq!(kinds(&found), vec![ChunkKind::Conflict]);
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
    }

    #[test]
    fn insertions_at_the_same_place_conflict() {
        let found = chunks("a\nb\n", "a\nx\nb\n", "a\ny\nb\n");
        assert_eq!(kinds(&found), vec![ChunkKind::Conflict]);
        assert_eq!((found[0].base_start, found[0].base_end), (1, 1));
    }
}
