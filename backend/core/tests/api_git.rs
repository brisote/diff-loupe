#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, RecordedEvents};
use diffloupe_core::testutil::{TempRepo, git_in, isolate, make_executable, test_env};
use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use std::sync::Arc;

fn open(repo: &TempRepo) -> (tempfile::TempDir, Core, Arc<RecordedEvents>, Value) {
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    let info = core
        .dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    (data, core, events, info["path"].clone())
}

fn call(core: &Core, cmd: &str, args: Value) -> Value {
    core.dispatch(cmd, args)
        .unwrap_or_else(|e| panic!("{cmd} failed: {e:?}"))
}

fn changed(core: &Core, path: &Value) -> Vec<String> {
    call(core, "status", json!({ "path": path }))
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["path"].as_str().unwrap().to_string())
        .collect()
}

fn three_changes() -> TempRepo {
    let repo = TempRepo::new();
    for name in ["a.txt", "b.txt", "c.txt"] {
        repo.write(name, "one\n");
    }
    repo.commit_all("Add files");
    for name in ["a.txt", "b.txt", "c.txt"] {
        repo.write(name, "two\n");
    }
    repo
}

fn clone_of(remote: &Path) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    git_in(
        dir.path(),
        &["clone", "-q", &remote.display().to_string(), "other"],
    );
    let path = dir.path().join("other");
    isolate(&path);
    (dir, path)
}

#[test]
fn committing_two_of_three_files_leaves_the_third_changed() {
    let repo = three_changes();
    repo.git(&["add", "c.txt"]);
    let (_data, core, _events, path) = open(&repo);
    let result = call(
        &core,
        "commit",
        json!({ "path": path, "message": "Change a and b", "amend": false, "files": ["a.txt", "b.txt"] }),
    );
    assert_eq!(result["short"].as_str().unwrap().len(), 8);
    assert_eq!(changed(&core, &path), ["c.txt"]);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Change a and b");
    assert_eq!(
        repo.git(&["show", "--name-only", "--format=", "HEAD"]),
        "a.txt\nb.txt"
    );
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "c.txt");
}

#[test]
fn a_commit_can_add_new_and_deleted_files_and_remembers_the_message() {
    let repo = TempRepo::with_commit();
    repo.write("new.txt", "new\n");
    repo.remove("README.md");
    let (_data, core, _events, path) = open(&repo);
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "  Add new, drop readme\n", "amend": false, "files": ["new.txt", "README.md"] }),
    );
    assert!(changed(&core, &path).is_empty());
    assert_eq!(repo.git(&["ls-files"]), "new.txt");
    assert_eq!(
        call(&core, "commit_messages", json!({ "path": path })),
        json!(["Add new, drop readme"])
    );
}

#[test]
fn amend_rewrites_the_last_commit_and_head_message_reads_it() {
    let repo = three_changes();
    let (_data, core, _events, path) = open(&repo);
    assert_eq!(
        call(&core, "head_message", json!({ "path": path })),
        "Add files"
    );
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "Add the files", "amend": true, "files": ["a.txt"] }),
    );
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Add the files");
    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "two");
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "Only the message", "amend": true, "files": [] }),
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Only the message");
    assert_eq!(changed(&core, &path), ["b.txt", "c.txt"]);
}

#[test]
fn a_commit_needs_a_message_and_files_and_reports_a_failing_hook() {
    let repo = three_changes();
    let (_data, core, _events, path) = open(&repo);
    let err = core
        .dispatch(
            "commit",
            json!({ "path": path, "message": " ", "amend": false, "files": ["a.txt"] }),
        )
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "invalidArgs");
    let err = core
        .dispatch(
            "commit",
            json!({ "path": path, "message": "x", "amend": false, "files": [] }),
        )
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "invalidArgs");
    let hook = repo.path().join(".git/hooks/pre-commit");
    fs::write(
        &hook,
        "#!/bin/sh\necho 'lint found 2 problems' >&2\nexit 1\n",
    )
    .unwrap();
    make_executable(&hook);
    let err = core
        .dispatch(
            "commit",
            json!({ "path": path, "message": "Try", "amend": false, "files": ["a.txt"] }),
        )
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "gitRefused");
    assert!(
        err.message.contains("lint found 2 problems"),
        "{}",
        err.message
    );
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "1");
}

#[test]
fn branches_lists_recent_local_and_remote_branches() {
    let repo = TempRepo::with_commit();
    repo.bare_remote();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.branch("gs/csv-writer");
    repo.git(&["push", "-q", "origin", "gs/csv-writer"]);
    repo.branch("gs/totals");
    repo.switch("main");
    repo.branch("gs/invoice-export");
    let (_data, core, _events, path) = open(&repo);
    let branches = call(&core, "branches", json!({ "path": path }));
    assert_eq!(branches["current"], "gs/invoice-export");
    assert_eq!(
        branches["recent"],
        json!(["gs/invoice-export", "main", "gs/totals", "gs/csv-writer"])
    );
    assert_eq!(
        branches["local"],
        json!(["gs/csv-writer", "gs/invoice-export", "gs/totals", "main"])
    );
    assert_eq!(
        branches["remote"],
        json!(["origin/gs/csv-writer", "origin/main"])
    );
}

#[test]
fn switching_branches_checks_out_local_and_remote_branches() {
    let repo = TempRepo::with_commit();
    let remote = repo.bare_remote();
    repo.git(&["push", "-q", "origin", "main"]);
    let (_other_dir, other) = clone_of(&remote);
    git_in(&other, &["switch", "-q", "-c", "gs/ledger"]);
    fs::write(other.join("ledger.txt"), "l\n").unwrap();
    git_in(&other, &["add", "-A"]);
    git_in(&other, &["commit", "-q", "-m", "Ledger"]);
    git_in(&other, &["push", "-q", "origin", "gs/ledger"]);
    repo.git(&["fetch", "-q"]);
    repo.branch("gs/feature");
    let (_data, core, _events, path) = open(&repo);
    let info = call(
        &core,
        "switch_branch",
        json!({ "path": path, "name": "main" }),
    );
    assert_eq!(info["branch"], "main");
    let info = call(
        &core,
        "switch_branch",
        json!({ "path": path, "name": "origin/gs/ledger" }),
    );
    assert_eq!(info["branch"], "gs/ledger");
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "@{u}"]),
        "origin/gs/ledger"
    );
    assert!(repo.path().join("ledger.txt").exists());
    assert_eq!(
        call(&core, "recent_repos", Value::Null)[0]["branch"],
        "gs/ledger"
    );
}

#[test]
fn a_switch_that_would_lose_changes_shows_gits_message() {
    let repo = TempRepo::with_commit();
    repo.branch("gs/other");
    repo.write("README.md", "# Other\n");
    repo.commit_all("Other readme");
    repo.switch("main");
    repo.write("README.md", "# Local edit\n");
    let (_data, core, _events, path) = open(&repo);
    let err = core
        .dispatch("switch_branch", json!({ "path": path, "name": "gs/other" }))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "gitRefused");
    assert!(
        err.message.contains("would be overwritten"),
        "{}",
        err.message
    );
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
}

#[test]
fn push_sets_an_upstream_then_pushes_and_reports_a_rejection() {
    let repo = TempRepo::with_commit();
    let remote = repo.bare_remote();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.branch("gs/feature");
    repo.write("a.txt", "a\n");
    repo.commit_all("Add a");
    let (_data, core, events, path) = open(&repo);
    let first = call(&core, "push", json!({ "path": path }));
    assert_eq!(
        first,
        json!({ "status": "pushed", "remoteBranch": "origin/gs/feature", "commits": 1 })
    );
    assert!(events.take().iter().any(|e| matches!(
        e,
        CoreEvent::Task { label, cancellable: true, .. } if label == "Pushing gs/feature to origin"
    )));
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "@{u}"]),
        "origin/gs/feature"
    );
    repo.write("b.txt", "b\n");
    repo.commit_all("Add b");
    repo.write("c.txt", "c\n");
    repo.commit_all("Add c");
    let second = call(&core, "push", json!({ "path": path }));
    assert_eq!(second["commits"], 2);

    let (_other_dir, other) = clone_of(&remote);
    git_in(&other, &["switch", "-q", "gs/feature"]);
    for name in ["x.txt", "y.txt"] {
        fs::write(other.join(name), "x\n").unwrap();
        git_in(&other, &["add", "-A"]);
        git_in(&other, &["commit", "-q", "-m", name]);
    }
    git_in(&other, &["push", "-q"]);
    repo.write("d.txt", "d\n");
    repo.commit_all("Add d");
    let rejected = call(&core, "push", json!({ "path": path }));
    assert_eq!(rejected["status"], "rejected");
    assert_eq!(rejected["remoteBranch"], "origin/gs/feature");
    assert_eq!(rejected["behind"], 2);
    assert!(rejected["details"].as_str().unwrap().contains("[rejected]"));

    let pulled = call(&core, "pull", json!({ "path": path }));
    assert_eq!(
        pulled,
        json!({ "status": "merged", "from": "origin/gs/feature" })
    );
    assert!(repo.path().join("x.txt").exists());
    assert_eq!(
        call(&core, "push", json!({ "path": path }))["status"],
        "pushed"
    );
}

#[test]
fn a_pull_that_conflicts_lists_the_files() {
    let repo = TempRepo::with_commit();
    let remote = repo.bare_remote();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let (_other_dir, other) = clone_of(&remote);
    fs::write(other.join("README.md"), "# Theirs\n").unwrap();
    git_in(&other, &["commit", "-q", "-am", "Theirs"]);
    git_in(&other, &["push", "-q"]);
    repo.write("README.md", "# Ours\n");
    repo.commit_all("Ours");
    let (_data, core, _events, path) = open(&repo);
    let pulled = call(&core, "pull", json!({ "path": path }));
    assert_eq!(
        pulled,
        json!({ "status": "conflicts", "from": "origin/main", "count": 1 })
    );
}

#[test]
fn push_without_a_remote_or_branch_explains_why() {
    let repo = TempRepo::with_commit();
    let (_data, core, _events, path) = open(&repo);
    let err = core.dispatch("push", json!({ "path": path })).unwrap_err();
    assert!(err.message.contains("has no remote"), "{}", err.message);
    let head = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["switch", "-q", "--detach", &head]);
    let err = core.dispatch("push", json!({ "path": path })).unwrap_err();
    assert!(
        err.message.contains("Switch to a branch"),
        "{}",
        err.message
    );
}

#[test]
fn fetch_updates_remote_branches_and_cancel_ignores_unknown_tasks() {
    let repo = TempRepo::with_commit();
    let remote = repo.bare_remote();
    repo.git(&["push", "-q", "origin", "main"]);
    let (_other_dir, other) = clone_of(&remote);
    git_in(&other, &["switch", "-q", "-c", "gs/new"]);
    git_in(&other, &["push", "-q", "origin", "gs/new"]);
    let (_data, core, _events, path) = open(&repo);
    call(&core, "fetch", json!({ "path": path }));
    let branches = call(&core, "branches", json!({ "path": path }));
    assert!(
        branches["remote"]
            .as_array()
            .unwrap()
            .contains(&json!("origin/gs/new"))
    );
    assert_eq!(
        call(&core, "cancel", json!({ "id": "push:/nowhere" })),
        false
    );
}

#[test]
fn a_running_fetch_can_be_cancelled() {
    let repo = TempRepo::with_commit();
    let script = repo.path().join("slow-remote.sh");
    fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
    make_executable(&script);
    let url = format!("ext::{}", script.display());
    repo.git(&["remote", "add", "origin", &url]);
    repo.git(&["config", "protocol.ext.allow", "always"]);
    let (_data, core, events, path) = open(&repo);
    let core = Arc::new(core);
    let worker = {
        let core = core.clone();
        let path = path.clone();
        std::thread::spawn(move || core.dispatch("fetch", json!({ "path": path })))
    };
    let id = loop {
        let started = events.take().into_iter().find_map(|e| match e {
            CoreEvent::Task {
                id,
                cancellable: true,
                done: false,
                ..
            } => Some(id),
            _ => None,
        });
        if let Some(id) = started {
            break id;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    let busy = core.dispatch("push", json!({ "path": path })).unwrap_err();
    assert!(
        busy.message.contains("Another git action"),
        "{}",
        busy.message
    );
    let start = std::time::Instant::now();
    while core.dispatch("cancel", json!({ "id": id })).unwrap() != json!(true) {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let err = worker.join().unwrap().unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "cancelled");
    assert!(start.elapsed() < std::time::Duration::from_secs(5));
    std::thread::sleep(std::time::Duration::from_millis(200));
    let left = std::process::Command::new("pgrep")
        .args(["-f", &script.display().to_string()])
        .output()
        .unwrap();
    let processes = std::process::Command::new("ps")
        .args(["-eo", "pid,pgid,ppid,command"])
        .output()
        .unwrap();
    assert!(
        left.stdout.is_empty(),
        "the remote helper is still running: {}\n{}",
        String::from_utf8_lossy(&left.stdout),
        String::from_utf8_lossy(&processes.stdout)
            .lines()
            .filter(|line| line.contains("slow-remote") || line.contains("git"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn a_staged_rename_and_a_comment_like_message_commit_as_they_are() {
    let repo = TempRepo::with_commit();
    repo.write("old.txt", "keep\n");
    repo.commit_all("Add old");
    repo.git(&["mv", "old.txt", "new.txt"]);
    repo.git(&["rm", "-q", "README.md"]);
    let (_data, core, _events, path) = open(&repo);
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "#482 Rename\n\n# kept", "amend": false, "files": ["old.txt", "new.txt", "README.md"] }),
    );
    assert!(changed(&core, &path).is_empty());
    assert_eq!(repo.git(&["ls-files"]), "new.txt");
    assert_eq!(
        repo.git(&["log", "-1", "--format=%B"]),
        "#482 Rename\n\n# kept"
    );
}

#[test]
fn two_fetches_get_their_own_tasks() {
    let repo = TempRepo::with_commit();
    repo.bare_remote();
    let (_data, core, events, path) = open(&repo);
    call(&core, "fetch", json!({ "path": path }));
    call(&core, "fetch", json!({ "path": path }));
    let ids: std::collections::HashSet<String> = events
        .take()
        .into_iter()
        .filter_map(|e| match e {
            CoreEvent::Task { id, .. } if id.starts_with("fetch:") => Some(id),
            _ => None,
        })
        .collect();
    assert_eq!(ids.len(), 2);
}

#[test]
fn a_rejected_first_push_can_fetch_and_merge_the_remote_branch() {
    let repo = TempRepo::with_commit();
    let remote = repo.bare_remote();
    repo.git(&["push", "-q", "origin", "main"]);
    let (_other_dir, other) = clone_of(&remote);
    git_in(&other, &["switch", "-q", "-c", "gs/shared"]);
    fs::write(other.join("theirs.txt"), "t\n").unwrap();
    git_in(&other, &["add", "-A"]);
    git_in(&other, &["commit", "-q", "-m", "Theirs"]);
    git_in(&other, &["push", "-q", "origin", "gs/shared"]);
    repo.branch("gs/shared");
    repo.write("mine.txt", "m\n");
    repo.commit_all("Mine");
    let (_data, core, _events, path) = open(&repo);
    let rejected = call(&core, "push", json!({ "path": path }));
    assert_eq!(rejected["status"], "rejected");
    assert_eq!(rejected["behind"], 1);
    assert_eq!(
        call(&core, "pull", json!({ "path": path }))["status"],
        "merged"
    );
    assert!(repo.path().join("theirs.txt").exists());
    assert_eq!(
        call(&core, "push", json!({ "path": path }))["status"],
        "pushed"
    );
}

#[test]
fn a_branch_made_from_the_remote_main_pushes_to_its_own_name() {
    let repo = TempRepo::with_commit();
    repo.bare_remote();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&[
        "switch",
        "-q",
        "-c",
        "gs/from-main",
        "--track",
        "origin/main",
    ]);
    repo.write("a.txt", "a\n");
    repo.commit_all("Add a");
    let (_data, core, _events, path) = open(&repo);
    let pushed = call(&core, "push", json!({ "path": path }));
    assert_eq!(pushed["remoteBranch"], "origin/gs/from-main");
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "@{u}"]),
        "origin/gs/from-main"
    );
}

#[test]
fn a_conflicted_pull_lists_odd_names_and_the_merge_commits_from_the_dialog() {
    let repo = TempRepo::with_commit();
    let remote = repo.bare_remote();
    repo.write("Prüfung notes.md", "base\n");
    repo.commit_all("Add notes");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let (_other_dir, other) = clone_of(&remote);
    fs::write(other.join("Prüfung notes.md"), "theirs\n").unwrap();
    git_in(&other, &["commit", "-q", "-am", "Theirs"]);
    git_in(&other, &["push", "-q"]);
    repo.write("Prüfung notes.md", "ours\n");
    repo.commit_all("Ours");
    let (_data, core, _events, path) = open(&repo);
    let pulled = call(&core, "pull", json!({ "path": path }));
    assert_eq!(pulled["count"], 1);
    let state = call(&core, "merge_state", json!({ "path": path }));
    assert_eq!(state["conflicts"][0]["path"], "Prüfung notes.md");
    let again = core.dispatch("pull", json!({ "path": path })).unwrap_err();
    assert!(
        again.message.contains("already in progress"),
        "{}",
        again.message
    );
    repo.write("Prüfung notes.md", "both\n");
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "Merge the notes", "amend": false, "files": ["Prüfung notes.md"] }),
    );
    assert_eq!(
        repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"])
            .split(' ')
            .count(),
        3
    );
    assert!(changed(&core, &path).is_empty());
}

#[test]
fn amending_a_pushed_commit_is_refused() {
    let repo = three_changes();
    repo.bare_remote();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let (_data, core, _events, path) = open(&repo);
    let err = core
        .dispatch(
            "commit",
            json!({ "path": path, "message": "Again", "amend": true, "files": ["a.txt"] }),
        )
        .unwrap_err();
    assert!(
        err.message.contains("already on origin/main"),
        "{}",
        err.message
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Add files");
}

#[test]
fn a_case_only_rename_commits() {
    let repo = TempRepo::with_commit();
    repo.write("Readme.txt", "r\n");
    repo.commit_all("Add readme");
    repo.git(&["mv", "Readme.txt", "README.txt"]);
    let (_data, core, _events, path) = open(&repo);
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "Rename", "amend": false, "files": ["Readme.txt", "README.txt"] }),
    );
    assert!(changed(&core, &path).is_empty());
    assert!(repo.git(&["ls-files"]).lines().any(|l| l == "README.txt"));
    assert!(!repo.git(&["ls-files"]).lines().any(|l| l == "Readme.txt"));
}

#[test]
fn a_staged_version_commits_without_the_edit_made_after_staging() {
    let repo = TempRepo::with_commit();
    repo.write("notes.md", "staged\n");
    repo.git(&["add", "notes.md"]);
    repo.write("notes.md", "staged\nlater\n");
    let (_data, core, _events, path) = open(&repo);
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "Add notes", "amend": false, "files": [], "staged": ["notes.md"] }),
    );
    assert_eq!(repo.git(&["show", "HEAD:notes.md"]), "staged");
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    assert_eq!(repo.git(&["diff", "--name-only"]), "notes.md");
}

#[test]
fn staged_renames_and_deletions_commit_and_a_working_version_wins_over_its_staged_one() {
    let repo = TempRepo::new();
    repo.write("old.md", "body\n");
    repo.write("gone.txt", "bye\n");
    repo.write("both.txt", "one\n");
    repo.commit_all("Initial commit");
    repo.git(&["mv", "old.md", "new.md"]);
    repo.git(&["rm", "-q", "gone.txt"]);
    repo.write("both.txt", "two\n");
    repo.git(&["add", "both.txt"]);
    repo.write("both.txt", "three\n");
    let (_data, core, _events, path) = open(&repo);
    call(
        &core,
        "commit",
        json!({
            "path": path, "message": "Tidy", "amend": false,
            "files": ["both.txt"], "staged": ["new.md", "old.md", "gone.txt", "both.txt"]
        }),
    );
    assert_eq!(repo.git(&["ls-files"]), "both.txt\nnew.md");
    assert_eq!(repo.git(&["show", "HEAD:both.txt"]), "three");
    assert!(changed(&core, &path).is_empty());
}

#[test]
fn a_commit_with_nothing_picked_is_refused_even_with_staged_files_elsewhere() {
    let repo = three_changes();
    repo.git(&["add", "a.txt"]);
    let (_data, core, _events, path) = open(&repo);
    let error = core
        .dispatch(
            "commit",
            json!({ "path": path, "message": "Nothing", "amend": false, "files": [], "staged": [] }),
        )
        .unwrap_err();
    assert_eq!(serde_json::to_value(error.code).unwrap(), "invalidArgs");
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "a.txt");
}

#[test]
fn a_staged_file_replaced_by_a_folder_commits_only_the_deletion() {
    let repo = TempRepo::new();
    repo.write("docs", "a file\n");
    repo.commit_all("Initial commit");
    repo.git(&["rm", "-q", "docs"]);
    repo.write("docs/guide.md", "guide\n");
    repo.git(&["add", "docs/guide.md"]);
    let (_data, core, _events, path) = open(&repo);
    call(
        &core,
        "commit",
        json!({ "path": path, "message": "Drop docs", "amend": false, "files": [], "staged": ["docs"] }),
    );
    assert_eq!(repo.git(&["ls-tree", "-r", "--name-only", "HEAD"]), "");
    assert_eq!(
        repo.git(&["diff", "--cached", "--name-only"]),
        "docs/guide.md"
    );
}

fn rollback(
    core: &Core,
    path: &Value,
    files: &[&str],
    delete_added: bool,
) -> Result<Value, String> {
    core.dispatch(
        "rollback",
        json!({ "path": path, "files": files, "deleteAdded": delete_added }),
    )
    .map_err(|e| e.message)
}

#[test]
fn rollback_restores_changed_staged_and_deleted_files_from_head() {
    let repo = three_changes();
    repo.git(&["add", "b.txt"]);
    repo.write("b.txt", "three\n");
    repo.remove("c.txt");
    let (_data, core, _events, path) = open(&repo);
    rollback(&core, &path, &["a.txt", "b.txt", "c.txt"], false).unwrap();
    for name in ["a.txt", "b.txt", "c.txt"] {
        assert_eq!(fs::read_to_string(repo.path().join(name)).unwrap(), "one\n");
    }
    assert!(changed(&core, &path).is_empty());
}

#[test]
fn rollback_leaves_files_it_was_not_given() {
    let repo = three_changes();
    let (_data, core, _events, path) = open(&repo);
    rollback(&core, &path, &["a.txt"], false).unwrap();
    assert_eq!(changed(&core, &path), ["b.txt", "c.txt"]);
}

#[test]
fn an_added_file_is_kept_unless_its_copy_is_deleted() {
    let repo = TempRepo::with_commit();
    repo.write("new.txt", "new\n");
    repo.write("gone.txt", "gone\n");
    repo.git(&["add", "new.txt", "gone.txt"]);
    let (_data, core, _events, path) = open(&repo);
    rollback(&core, &path, &["new.txt"], false).unwrap();
    assert_eq!(
        fs::read_to_string(repo.path().join("new.txt")).unwrap(),
        "new\n"
    );
    assert_eq!(
        repo.git(&["status", "--porcelain", "--", "new.txt"]).trim(),
        "?? new.txt"
    );
    rollback(&core, &path, &["gone.txt"], true).unwrap();
    assert!(!repo.path().join("gone.txt").exists());
}

#[test]
fn a_renamed_file_returns_to_its_old_name() {
    let repo = TempRepo::with_commit();
    repo.write("old.txt", "text\n");
    repo.commit_all("Add old");
    repo.git(&["mv", "old.txt", "new.txt"]);
    let (_data, core, _events, path) = open(&repo);
    rollback(&core, &path, &["old.txt", "new.txt"], true).unwrap();
    assert!(repo.path().join("old.txt").exists());
    assert!(!repo.path().join("new.txt").exists());
    assert!(changed(&core, &path).is_empty());
}

#[test]
fn rollback_refuses_no_files_outside_paths_and_a_merge_in_progress() {
    let repo = TempRepo::with_commit();
    repo.write("a.txt", "base\n");
    repo.commit_all("Add a");
    repo.branch("gs/side");
    repo.write("a.txt", "side\n");
    repo.commit_all("Side");
    repo.switch("main");
    repo.write("a.txt", "main\n");
    repo.commit_all("Main");
    let (_data, core, _events, path) = open(&repo);
    assert!(
        rollback(&core, &path, &[], false)
            .unwrap_err()
            .contains("Pick at least one file")
    );
    assert!(
        rollback(&core, &path, &["../a.txt"], true)
            .unwrap_err()
            .contains("not a file of this repository")
    );
    assert!(repo.git_fails(&["merge", "-q", "gs/side"]));
    let error = rollback(&core, &path, &["a.txt"], false).unwrap_err();
    assert!(error.contains("A merge is in progress"), "{error}");
    assert!(
        fs::read_to_string(repo.path().join("a.txt"))
            .unwrap()
            .contains("<<<<<<<")
    );
}

#[test]
fn rollback_works_before_the_first_commit() {
    let repo = TempRepo::new();
    repo.write("first.txt", "first\n");
    repo.git(&["add", "first.txt"]);
    let (_data, core, _events, path) = open(&repo);
    rollback(&core, &path, &["first.txt"], false).unwrap();
    assert_eq!(repo.git(&["status", "--porcelain"]).trim(), "?? first.txt");
}

#[test]
fn files_edited_again_after_staging_roll_back_too() {
    let repo = TempRepo::with_commit();
    repo.write("old.txt", "text\n");
    repo.commit_all("Add old");
    repo.write("n.txt", "one\n");
    repo.git(&["add", "n.txt"]);
    repo.write("n.txt", "two\n");
    repo.git(&["mv", "old.txt", "new.txt"]);
    repo.write("new.txt", "edited\n");
    repo.git(&["add", "new.txt"]);
    repo.write("new.txt", "edited again\n");
    let (_data, core, _events, path) = open(&repo);
    rollback(&core, &path, &["n.txt", "old.txt", "new.txt"], false).unwrap();
    assert_eq!(
        fs::read_to_string(repo.path().join("old.txt")).unwrap(),
        "text\n"
    );
    let status = repo.git(&["status", "--porcelain"]);
    let mut lines: Vec<&str> = status.lines().map(str::trim).collect();
    lines.sort();
    assert_eq!(lines, ["?? n.txt", "?? new.txt"]);
}
