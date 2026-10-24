use crate::settings::{Highlight, Whitespace};
use imara_diff::{Algorithm, Diff, InternedInput};
use serde::Serialize;
use ts_rs::TS;

const WORD_DIFF_LINE_LIMIT: u32 = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BlockKind {
    Inserted,
    Deleted,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WordRange {
    pub start: u32,
    pub end: u32,
    pub kind: BlockKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Block {
    pub kind: BlockKind,
    pub left_start: u32,
    pub left_end: u32,
    pub right_start: u32,
    pub right_end: u32,
    pub has_words: bool,
    pub left_words: Vec<WordRange>,
    pub right_words: Vec<WordRange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Options {
    pub whitespace: Whitespace,
    pub highlight: Highlight,
}

pub fn compare(left: &str, right: &str) -> Vec<Block> {
    compare_with(left, right, Options::default())
}

pub fn compare_with(left: &str, right: &str, options: Options) -> Vec<Block> {
    let before = LineKeys::new(left, options.whitespace);
    let after = LineKeys::new(right, options.whitespace);
    let mut input = InternedInput::default();
    input.update_before(before.keys.iter().map(|key| key.as_ref()));
    input.update_after(after.keys.iter().map(|key| key.as_ref()));
    let mut diff = Diff::compute(Algorithm::Histogram, &input);
    diff.postprocess_lines(&input);
    let left_lines = LineIndex::new(left);
    let right_lines = LineIndex::new(right);
    diff.hunks()
        .map(|hunk| {
            let (left_start, left_end) = before.original(hunk.before.start, hunk.before.end);
            let (right_start, right_end) = after.original(hunk.after.start, hunk.after.end);
            let kind = if left_start == left_end {
                BlockKind::Inserted
            } else if right_start == right_end {
                BlockKind::Deleted
            } else {
                BlockKind::Modified
            };
            let mut block = Block {
                kind,
                left_start,
                left_end,
                right_start,
                right_end,
                has_words: false,
                left_words: Vec::new(),
                right_words: Vec::new(),
            };
            let small = left_end - left_start <= WORD_DIFF_LINE_LIMIT
                && right_end - right_start <= WORD_DIFF_LINE_LIMIT;
            let words = matches!(options.highlight, Highlight::Words | Highlight::Characters);
            if kind == BlockKind::Modified && small && words {
                let before = left_lines.range(left_start, left_end);
                let after = right_lines.range(right_start, right_end);
                let (removed, added) =
                    word_changes(&left[before.clone()], &right[after.clone()], options);
                block.left_words = removed
                    .into_iter()
                    .map(|(a, b, kind)| {
                        left_lines.word(left, before.start + a, before.start + b, kind)
                    })
                    .collect();
                block.right_words = added
                    .into_iter()
                    .map(|(a, b, kind)| {
                        right_lines.word(right, after.start + a, after.start + b, kind)
                    })
                    .collect();
                block.has_words = true;
            }
            block
        })
        .collect()
}

struct LineKeys<'a> {
    keys: Vec<std::borrow::Cow<'a, str>>,
    lines: Vec<u32>,
    total: u32,
}

impl<'a> LineKeys<'a> {
    fn new(text: &'a str, whitespace: Whitespace) -> LineKeys<'a> {
        let mut keys = Vec::new();
        let mut lines = Vec::new();
        let mut total = 0;
        for (index, line) in imara_diff::sources::lines(text).enumerate() {
            total = index as u32 + 1;
            let key = match whitespace {
                Whitespace::DoNotIgnore => std::borrow::Cow::Borrowed(line),
                Whitespace::Trim => std::borrow::Cow::Borrowed(line.trim()),
                Whitespace::Ignore | Whitespace::IgnoreAndEmptyLines => {
                    std::borrow::Cow::Owned(line.chars().filter(|ch| !ch.is_whitespace()).collect())
                }
            };
            if whitespace == Whitespace::IgnoreAndEmptyLines && key.is_empty() {
                continue;
            }
            keys.push(key);
            lines.push(index as u32);
        }
        LineKeys { keys, lines, total }
    }

    fn original(&self, start: u32, end: u32) -> (u32, u32) {
        if start == end {
            let at = self
                .lines
                .get(start as usize)
                .copied()
                .unwrap_or(self.total);
            return (at, at);
        }
        let first = self.lines[start as usize];
        let last = self.lines[end as usize - 1];
        (first, last + 1)
    }
}

struct LineIndex {
    bytes: Vec<usize>,
    utf16: Vec<u32>,
    len: usize,
}

impl LineIndex {
    fn new(text: &str) -> LineIndex {
        let mut bytes = vec![0];
        let mut utf16 = vec![0];
        let mut units = 0u32;
        for (offset, ch) in text.char_indices() {
            units += ch.len_utf16() as u32;
            if ch == '\n' {
                bytes.push(offset + 1);
                utf16.push(units);
            }
        }
        LineIndex {
            bytes,
            utf16,
            len: text.len(),
        }
    }

    fn start(&self, line: u32) -> usize {
        self.bytes
            .get(line as usize)
            .copied()
            .unwrap_or_else(|| self.bytes.last().copied().unwrap_or(0))
    }

    fn range(&self, start: u32, end: u32) -> std::ops::Range<usize> {
        let end_byte = if (end as usize) < self.bytes.len() {
            self.start(end)
        } else {
            self.len
        };
        self.start(start)..end_byte
    }

    fn word(&self, text: &str, start: usize, end: usize, kind: BlockKind) -> WordRange {
        WordRange {
            start: self.utf16_at(text, start),
            end: self.utf16_at(text, end),
            kind,
        }
    }

    fn utf16_at(&self, text: &str, byte: usize) -> u32 {
        let line = self
            .bytes
            .partition_point(|&start| start <= byte)
            .saturating_sub(1);
        let from = self.bytes[line];
        self.utf16[line] + text[from..byte].encode_utf16().count() as u32
    }
}

fn keep(text: &str, offset: usize, token: &str, whitespace: Whitespace) -> bool {
    let blank = token.chars().all(|ch| ch == ' ' || ch == '\t');
    match whitespace {
        Whitespace::DoNotIgnore => true,
        Whitespace::Trim => {
            let at_start = offset == 0 || text[..offset].ends_with('\n');
            let end = offset + token.len();
            let at_end = end == text.len() || text[end..].starts_with('\n');
            !(blank && (at_start || at_end))
        }
        Whitespace::Ignore | Whitespace::IgnoreAndEmptyLines => !blank,
    }
}

fn characters(text: &str) -> Vec<(usize, &str)> {
    text.char_indices()
        .map(|(offset, ch)| (offset, &text[offset..offset + ch.len_utf8()]))
        .collect()
}

pub(crate) fn tokens(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some((offset, ch)) = chars.next() {
        let class = char_class(ch);
        let mut end = offset + ch.len_utf8();
        if class != CharClass::Other {
            while let Some(&(next, next_ch)) = chars.peek() {
                if char_class(next_ch) != class {
                    break;
                }
                end = next + next_ch.len_utf8();
                chars.next();
            }
        }
        out.push((offset, &text[offset..end]));
    }
    out
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum CharClass {
    Word,
    Space,
    Other,
}

fn char_class(ch: char) -> CharClass {
    if ch.is_alphanumeric() || ch == '_' {
        CharClass::Word
    } else if ch == ' ' || ch == '\t' {
        CharClass::Space
    } else {
        CharClass::Other
    }
}

type Spans = Vec<(usize, usize, BlockKind)>;

fn word_changes<'a>(left: &'a str, right: &'a str, options: Options) -> (Spans, Spans) {
    let split = |text: &'a str| -> Vec<(usize, &'a str)> {
        let pieces = match options.highlight {
            Highlight::Characters => characters(text),
            _ => tokens(text),
        };
        pieces
            .into_iter()
            .filter(|&(offset, token)| keep(text, offset, token, options.whitespace))
            .collect()
    };
    let before = split(left);
    let after = split(right);
    let mut input = InternedInput::default();
    input.update_before(before.iter().map(|(_, token)| *token));
    input.update_after(after.iter().map(|(_, token)| *token));
    let diff = Diff::compute(Algorithm::Histogram, &input);
    let mut removed = Vec::new();
    let mut added = Vec::new();
    for hunk in diff.hunks() {
        let kind = if hunk.before.is_empty() {
            BlockKind::Inserted
        } else if hunk.after.is_empty() {
            BlockKind::Deleted
        } else {
            BlockKind::Modified
        };
        removed
            .extend(span(&before, hunk.before.start, hunk.before.end).map(|(a, b)| (a, b, kind)));
        added.extend(span(&after, hunk.after.start, hunk.after.end).map(|(a, b)| (a, b, kind)));
    }
    (removed, added)
}

fn span(tokens: &[(usize, &str)], start: u32, end: u32) -> Option<(usize, usize)> {
    if start >= end {
        return None;
    }
    let first = tokens.get(start as usize)?;
    let last = tokens.get(end as usize - 1)?;
    let from = first.0;
    let to = if last.1 == "\n" {
        last.0
    } else {
        last.0 + last.1.len()
    };
    (to > from).then_some((from, to))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(blocks: &[Block]) -> Vec<(BlockKind, u32, u32, u32, u32)> {
        blocks
            .iter()
            .map(|b| (b.kind, b.left_start, b.left_end, b.right_start, b.right_end))
            .collect()
    }

    #[test]
    fn inserted_deleted_and_modified_blocks() {
        let left = "a\nb\nc\nd\ne\n";
        let right = "a\nB\nc\ninserted\nd\n";
        assert_eq!(
            lines(&compare(left, right)),
            [
                (BlockKind::Modified, 1, 2, 1, 2),
                (BlockKind::Inserted, 3, 3, 3, 4),
                (BlockKind::Deleted, 4, 5, 5, 5),
            ]
        );
    }

    #[test]
    fn a_renamed_variable_marks_only_the_word() {
        let left = "fun total(items: List) {\n    val sum = items.size\n}\n";
        let right = "fun total(items: List) {\n    val count = items.size\n}\n";
        let blocks = compare(left, right);
        assert_eq!(blocks.len(), 1);
        let block = &blocks[0];
        assert!(block.has_words);
        let WordRange {
            start: a, end: b, ..
        } = block.left_words[0];
        assert_eq!(
            &left.encode_utf16().collect::<Vec<_>>()[a as usize..b as usize],
            "sum".encode_utf16().collect::<Vec<_>>()
        );
        let WordRange {
            start: a, end: b, ..
        } = block.right_words[0];
        assert_eq!(
            String::from_utf16_lossy(
                &right.encode_utf16().collect::<Vec<_>>()[a as usize..b as usize]
            ),
            "count"
        );
    }

    #[test]
    fn word_offsets_count_utf16_units() {
        let left = "naïve 👋 old\n";
        let right = "naïve 👋 new\n";
        let block = &compare(left, right)[0];
        let units: Vec<u16> = right.encode_utf16().collect();
        let WordRange {
            start: a, end: b, ..
        } = block.right_words[0];
        assert_eq!(
            String::from_utf16_lossy(&units[a as usize..b as usize]),
            "new"
        );
    }

    #[test]
    fn the_last_line_without_a_newline_can_change() {
        let block = &compare("a\nold tail", "a\nnew tail")[0];
        assert_eq!(block.kind, BlockKind::Modified);
        assert_eq!(
            block.right_words,
            [WordRange {
                start: 2,
                end: 5,
                kind: BlockKind::Modified
            }]
        );
    }

    #[test]
    fn inserted_words_inside_a_changed_line_are_marked_as_inserted() {
        let block = &compare("total(a)\n", "total(a, b)\n")[0];
        assert_eq!(block.left_words, []);
        assert_eq!(block.right_words.len(), 1);
        assert_eq!(block.right_words[0].kind, BlockKind::Inserted);
    }

    #[test]
    fn a_new_file_is_one_inserted_block() {
        assert_eq!(
            lines(&compare("", "a\nb\n")),
            [(BlockKind::Inserted, 0, 0, 0, 2)]
        );
        assert_eq!(
            lines(&compare("a\nb\n", "")),
            [(BlockKind::Deleted, 0, 2, 0, 0)]
        );
    }

    fn with(whitespace: Whitespace, highlight: Highlight) -> Options {
        Options {
            whitespace,
            highlight,
        }
    }

    #[test]
    fn whitespace_modes_decide_what_counts_as_a_change() {
        let left = "fun a() {\n  x = 1\n\n}\n";
        let right = "fun a() {\n    x  =  1 \n}\n";
        let words = Highlight::Words;
        assert_eq!(
            compare_with(left, right, with(Whitespace::DoNotIgnore, words)).len(),
            1
        );
        let trimmed = compare_with(left, right, with(Whitespace::Trim, words));
        assert_eq!(lines(&trimmed), [(BlockKind::Modified, 1, 3, 1, 2)]);
        let ignored = compare_with(left, right, with(Whitespace::Ignore, words));
        assert_eq!(lines(&ignored), [(BlockKind::Deleted, 2, 3, 2, 2)]);
        assert!(compare_with(left, right, with(Whitespace::IgnoreAndEmptyLines, words)).is_empty());
    }

    #[test]
    fn trim_still_marks_changed_inner_whitespace() {
        let block = &compare_with(
            "  a = 1\n",
            "    a  = 1\n",
            with(Whitespace::Trim, Highlight::Words),
        )[0];
        assert_eq!(block.right_words.len(), 1);
        let word = block.right_words[0];
        assert_eq!((word.start, word.end), (5, 7));
    }

    #[test]
    fn ignoring_whitespace_keeps_original_line_numbers() {
        let left = "a\n\n\nb\nc\n";
        let right = "a\nb\nC\n";
        let blocks = compare_with(
            left,
            right,
            with(Whitespace::IgnoreAndEmptyLines, Highlight::Words),
        );
        assert_eq!(lines(&blocks), [(BlockKind::Modified, 4, 5, 2, 3)]);
    }

    #[test]
    fn highlighting_by_characters_lines_or_not_at_all() {
        let left = "let total = 10\n";
        let right = "let totals = 12\n";
        let chars = &compare_with(
            left,
            right,
            with(Whitespace::DoNotIgnore, Highlight::Characters),
        )[0];
        let marked: Vec<_> = chars.right_words.iter().map(|w| (w.start, w.end)).collect();
        assert_eq!(marked, [(9, 10), (14, 15)]);
        let by_lines =
            &compare_with(left, right, with(Whitespace::DoNotIgnore, Highlight::Lines))[0];
        assert!(!by_lines.has_words && by_lines.right_words.is_empty());
        let none = &compare_with(left, right, with(Whitespace::DoNotIgnore, Highlight::None))[0];
        assert!(!none.has_words);
    }

    #[test]
    fn fifty_thousand_lines_with_two_thousand_blocks_stay_fast() {
        let left: String = (0..50_000)
            .map(|i| format!("    value_{i} = compute({i})\n"))
            .collect();
        let right: String = left
            .lines()
            .enumerate()
            .map(|(i, line)| {
                if i % 25 == 0 {
                    format!("{line} // edited\n")
                } else {
                    format!("{line}\n")
                }
            })
            .collect();
        let started = std::time::Instant::now();
        let blocks = compare(&left, &right);
        assert_eq!(blocks.len(), 2000);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(8),
            "{:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_five_thousand_line_file_diffs_quickly() {
        let left: String = (0..5000)
            .map(|i| format!("    let value_{i} = compute({i});\n"))
            .collect();
        let right = left.replace("compute(4", "calculate(4");
        let started = std::time::Instant::now();
        let blocks = compare(&left, &right);
        assert!(!blocks.is_empty());
        assert!(
            started.elapsed() < std::time::Duration::from_millis(250),
            "{:?}",
            started.elapsed()
        );
    }
}
