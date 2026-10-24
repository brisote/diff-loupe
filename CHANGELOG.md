# Changelog

Each release lists what changed for the person who uses Diffloupe, and every change to stored data with its migration.

## 0.2.0

The first public release. Install it with one Terminal command from diffloupe.com, or from the disk image.

### Review

- The Changes list refreshes live and compares the branch with the merge base of its target branch.
- Side-by-side and unified diffs with word highlights, folded unchanged lines and synchronised scrolling.
- The branch log shows only the branch's own commits, with merges from the target branch as divider rows.
- Rendered Markdown diffs, side by side or inline.

### Git

- Commit, Commit and Push, branch switching, and merging the target branch into the branch.
- The 3-pane merge window for conflicts, with yours, the result and theirs.
- A terminal tool window that opens in the repository.

### Install

- The install command checks the SHA-256 checksum, replaces an older copy in Applications and keeps your data.
- Requires a Mac with Apple silicon and macOS 13 or later.

## 0.1.0

The first release.

- The Changes list refreshes live and compares the branch with the merge base of its target branch.
- Side-by-side and unified diffs with word highlights, folded unchanged lines and synchronised scrolling.
- The branch log shows only the branch's own commits, with merges from the target branch as divider rows.
- Rendered Markdown diffs, side by side or inline.
- Commit, Commit and Push, branch switching, and merging the target branch into the branch.
- The 3-pane merge window, with conflicts resolved by Claude Code as proposals you apply.
- Explain a selection, a file or a commit with Claude Code.
- A terminal tool window.
- Stored data: `state.db` schema 3 adds the `meta` table, which records the version that wrote the data. `settings.json` gets a `version` key, starting at 0. Stores from earlier development builds migrate on the first start, after a backup.
