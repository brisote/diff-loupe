# Changelog

Each release lists what changed for the person who uses Diffloupe, and every change to stored data with its migration.

## 0.4.0

Diffloupe comes to Windows as a per-user setup program, with the one-line PowerShell install command, updates and Uninstall.

### Windows

- Diffloupe runs on Windows 10 and 11 (64-bit).
- A per-user setup program installs without administrator rights.
- Install with one PowerShell command from diffloupe.com or download the setup program directly.
- The built-in terminal runs PowerShell, PowerShell 7 or Command Prompt.
- Line endings in CRLF working-tree files are converted before diffing and preserved on merge.
- The app updates itself silently from inside the app, and Uninstall removes every file Diffloupe owns.

### Install

- Nothing in your stored data changes.

## 0.3.0

Diffloupe comes to Linux as Debian and RPM packages, with the one-line install command, updates and Uninstall.

### Linux

- Diffloupe runs on Ubuntu 22.04+, Debian 12+ and Fedora 40+.
- Native .deb and .rpm packages install and update with your system package manager.
- Install with one command from diffloupe.com or download the package directly.
- The app updates itself from inside the app and Uninstall removes every file Diffloupe owns.

### Review

- A dedicated Local changes tab keeps uncommitted work separate from Review.
- Conflicted files open directly into the three-way merge view from the Review tab.

### Install

- Nothing in your stored data changes.

## 0.2.2

A branch log drawn as a commit graph, folded Markdown, and Markdown changes marked where they happen.

### Review

- The branch log draws the branch's commits as a graph.
- A target branch that is the same as the current branch is marked as an error.
- With Collapse Unchanged Fragments on, the rendered Markdown view folds the blocks that did not change.

### Git

- A commit's menu copies its message and its author.

### Look

- Every colour is slightly adjusted.

### Fixed

- In the rendered Markdown view, a change inside a nested list or a quote marks only the item that changed, not the whole section.
- In the rendered side-by-side view, each version scrolls in its own pane, so a wide table no longer runs into the other side.

### Install

- Nothing in your stored data changes.

## 0.2.1

A simpler branch log, a working Rollback and an update check on diffloupe.com.

### Review

- The branch log shows the branch's commit history, newest first, with merges as ordinary commits. It works on the default branch too.
- The target branch belongs to the Changes tab, and the current branch is no longer offered as a target.
- Rollback restores the files you tick to their last commit. Added files keep their copy unless you choose to delete it.

### Updates

- The update check is ready for more platforms. Each update is still checked against its SHA-256 checksum before it installs.

### Fixed

- An installed or updated Diffloupe shows in Spotlight at once.
- The Uninstall dialog no longer lists every file it deletes.

### Install

- Nothing in your stored data changes.

## 0.2.0

The first public release, open source on GitHub, with updates from inside the app. Install it with one Terminal command from diffloupe.com, or from the disk image.

### Review

- The Changes list refreshes live and compares the branch with the merge base of its target branch.
- Side-by-side and unified diffs with word highlights, folded unchanged lines and synchronised scrolling.
- The branch log shows only the branch's own commits, with merges from the target branch as divider rows.
- Rendered Markdown diffs, side by side or inline, with one placeholder line for a run of added or removed blocks.

### Git

- Commit, Commit and Push, branch switching, and merging the target branch into the branch.
- The 3-pane merge window for conflicts, with yours, the result and theirs.
- A terminal tool window that opens in the repository.

### Updates

- Diffloupe checks GitHub for a new version at start and once a day. Turn it off in Settings, under Updates.
- Update downloads the new version, checks its SHA-256 checksum and installs it when you restart or quit. Your settings stay.

### Also new

- After a week of use Diffloupe asks once for a star on GitHub, and once more a month after Not now.
- An unexpected error opens a report you can paste into a GitHub issue. Diffloupe sends nothing itself.

### Install

- The install command checks the SHA-256 checksum, replaces an older copy in Applications and keeps your data.
- Requires a Mac with Apple silicon and macOS 13 or later.
- Settings gain an Updates section, and settings from 0.1.0 get it with checks on. Nothing else in your stored data changes.

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
