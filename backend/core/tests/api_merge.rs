#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::RecordedEvents;
use diffloupe_core::testutil::{TempRepo, git_in, isolate, test_env};
use serde_json::{Value, json};
use std::fs;
use std::sync::Arc;

fn open(repo: &TempRepo) -> (tempfile::TempDir, Core, Value) {
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(RecordedEvents::default())).unwrap();
    let info = core
        .dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    (data, core, info["path"].clone())
}

fn call(core: &Core, cmd: &str, args: Value) -> Value {
    core.dispatch(cmd, args)
        .unwrap_or_else(|e| panic!("{cmd} failed: {e:?}"))
}

fn conflicting() -> TempRepo {
    let repo = TempRepo::new();
    for name in ["both.txt", "gone-here.txt", "gone-there.txt"] {
        repo.write(name, "base\n");
    }
    repo.commit_all("Base");
    repo.branch("gs/feature");
    repo.write("both.txt", "ours\n");
    repo.remove("gone-here.txt");
    repo.write("gone-there.txt", "ours\n");
    repo.write("new.txt", "ours new\n");
    repo.commit_all("Ours");
    repo.switch("main");
    repo.write("both.txt", "theirs\n");
    repo.write("gone-here.txt", "theirs\n");
    repo.remove("gone-there.txt");
    repo.write("new.txt", "theirs new\n");
    repo.commit_all("Theirs");
    repo.switch("gs/feature");
    repo
}

fn side(state: &Value, path: &str) -> (String, String) {
    let conflict = state["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["path"] == path)
        .unwrap_or_else(|| panic!("no conflict for {path} in {state}"));
    (
        conflict["ours"].as_str().unwrap().to_string(),
        conflict["theirs"].as_str().unwrap().to_string(),
    )
}

#[test]
fn merging_the_target_reports_each_kind_of_conflict() {
    let repo = conflicting();
    let (_data, core, path) = open(&repo);
    assert_eq!(
        call(&core, "merge_state", json!({ "path": path })),
        json!({ "operation": null, "theirs": null, "conflicts": [], "message": null })
    );
    let merged = call(&core, "merge_target", json!({ "path": path }));
    assert_eq!(
        merged,
        json!({ "status": "conflicts", "from": "main", "count": 4 })
    );
    let state = call(&core, "merge_state", json!({ "path": path }));
    assert_eq!(state["operation"], "merge");
    assert_eq!(state["theirs"], "main");
    assert!(
        state["message"]
            .as_str()
            .unwrap()
            .starts_with("Merge branch 'main' into gs/feature")
    );
    assert!(!state["message"].as_str().unwrap().contains('#'));
    assert_eq!(
        side(&state, "both.txt"),
        ("modified".into(), "modified".into())
    );
    assert_eq!(
        side(&state, "gone-here.txt"),
        ("deleted".into(), "modified".into())
    );
    assert_eq!(
        side(&state, "gone-there.txt"),
        ("modified".into(), "deleted".into())
    );
    assert_eq!(side(&state, "new.txt"), ("added".into(), "added".into()));
    let again = core
        .dispatch("merge_target", json!({ "path": path }))
        .unwrap_err();
    assert!(
        again.message.contains("already in progress"),
        "{}",
        again.message
    );
}

#[test]
fn accepting_sides_resolves_every_file_and_the_merge_commits() {
    let repo = conflicting();
    let (_data, core, path) = open(&repo);
    call(&core, "merge_target", json!({ "path": path }));
    let accept = |files: &[&str], side: &str| {
        call(
            &core,
            "accept_side",
            json!({ "path": path, "files": files, "side": side }),
        )
    };
    accept(&["both.txt", "new.txt"], "ours");
    accept(&["gone-here.txt"], "theirs");
    accept(&["gone-there.txt"], "theirs");
    assert_eq!(
        fs::read_to_string(repo.path().join("both.txt")).unwrap(),
        "ours\n"
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("new.txt")).unwrap(),
        "ours new\n"
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("gone-here.txt")).unwrap(),
        "theirs\n"
    );
    assert!(!repo.path().join("gone-there.txt").exists());
    let state = call(&core, "merge_state", json!({ "path": path }));
    assert_eq!(state["operation"], "merge");
    assert_eq!(state["conflicts"], json!([]));
    let err = core
        .dispatch(
            "accept_side",
            json!({ "path": path, "files": ["both.txt"], "side": "ours" }),
        )
        .unwrap_err();
    assert!(err.message.contains("no conflict"), "{}", err.message);

    let files: Vec<String> = call(&core, "status", json!({ "path": path }))
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["path"].as_str().unwrap().to_string())
        .collect();
    call(
        &core,
        "commit",
        json!({ "path": path, "message": state["message"], "amend": false, "files": files }),
    );
    assert_eq!(
        repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"])
            .split(' ')
            .count(),
        3
    );
    assert!(
        repo.git(&["log", "-1", "--format=%s"])
            .starts_with("Merge branch 'main'")
    );
    assert_eq!(
        call(&core, "merge_state", json!({ "path": path }))["operation"],
        Value::Null
    );
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn accepting_a_deleted_side_removes_the_file() {
    let repo = conflicting();
    let (_data, core, path) = open(&repo);
    call(&core, "merge_target", json!({ "path": path }));
    call(
        &core,
        "accept_side",
        json!({ "path": path, "files": ["gone-here.txt", "both.txt"], "side": "ours" }),
    );
    assert!(!repo.path().join("gone-here.txt").exists());
    let state = call(&core, "merge_state", json!({ "path": path }));
    let left: Vec<&str> = state["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["path"].as_str().unwrap())
        .collect();
    assert_eq!(left, vec!["gone-there.txt", "new.txt"]);
}

#[test]
fn an_edit_made_while_resolving_stays_out_of_the_merge_commit() {
    let repo = conflicting();
    repo.write("local.txt", "a separate file\n");
    repo.commit_all("Local file");
    let (_data, core, path) = open(&repo);
    let merged = call(&core, "merge_target", json!({ "path": path }));
    assert_eq!(merged["status"], "conflicts", "{merged}");
    repo.write("local.txt", "my edit\n");
    call(
        &core,
        "accept_side",
        json!({ "path": path, "files": ["both.txt", "gone-here.txt", "gone-there.txt", "new.txt"], "side": "ours" }),
    );
    let message = call(&core, "merge_state", json!({ "path": path }))["message"].clone();
    call(
        &core,
        "commit",
        json!({ "path": path, "message": message, "amend": false, "files": [] }),
    );
    assert_eq!(repo.git(&["show", "HEAD:local.txt"]), "a separate file");
    assert_eq!(repo.git(&["status", "--porcelain"]), "M local.txt");
}

#[test]
fn aborting_restores_the_branch() {
    let repo = conflicting();
    let (_data, core, path) = open(&repo);
    let before = repo.git(&["rev-parse", "HEAD"]);
    call(&core, "merge_target", json!({ "path": path }));
    call(&core, "abort_merge", json!({ "path": path }));
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
    assert_eq!(
        fs::read_to_string(repo.path().join("both.txt")).unwrap(),
        "ours\n"
    );
    let err = core
        .dispatch("abort_merge", json!({ "path": path }))
        .unwrap_err();
    assert!(err.message.contains("No merge"), "{}", err.message);
}

#[test]
fn the_target_is_fetched_before_it_is_merged() {
    let repo = TempRepo::with_commit();
    let remote = repo.bare_remote();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.branch("gs/feature");
    repo.write("mine.txt", "m\n");
    repo.commit_all("Mine");
    let dir = tempfile::tempdir().unwrap();
    git_in(
        dir.path(),
        &["clone", "-q", &remote.display().to_string(), "other"],
    );
    let other = dir.path().join("other");
    isolate(&other);
    fs::write(other.join("theirs.txt"), "t\n").unwrap();
    git_in(&other, &["add", "-A"]);
    git_in(&other, &["commit", "-q", "-m", "Theirs"]);
    git_in(&other, &["push", "-q"]);

    let (_data, core, path) = open(&repo);
    assert_eq!(
        call(&core, "merge_target", json!({ "path": path })),
        json!({ "status": "merged", "from": "main" })
    );
    assert!(repo.path().join("theirs.txt").exists());
    assert!(
        repo.git(&["log", "-1", "--format=%s"])
            .contains("origin/main")
    );
    assert_eq!(
        call(&core, "merge_target", json!({ "path": path })),
        json!({ "status": "upToDate", "from": "main" })
    );
}

#[test]
fn local_changes_that_a_merge_would_overwrite_block_it() {
    let repo = conflicting();
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["switch", "-q", "-c", "gs/other", "HEAD~1"]);
    repo.write("both.txt", "local edit\n");
    let (_data, core, path) = open(&repo);
    assert_eq!(
        call(&core, "merge_target", json!({ "path": path })),
        json!({ "status": "blocked", "from": "main", "files": ["both.txt"] })
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("both.txt")).unwrap(),
        "local edit\n"
    );
    assert_eq!(
        call(&core, "merge_state", json!({ "path": path }))["operation"],
        Value::Null
    );
}

#[test]
fn a_missing_target_and_a_rebase_in_progress_are_refused() {
    let repo = conflicting();
    let (_data, core, path) = open(&repo);
    call(
        &core,
        "set_target",
        json!({ "path": path, "target": "gs/missing" }),
    );
    let err = core
        .dispatch("merge_target", json!({ "path": path }))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "targetNotFound");
    call(
        &core,
        "set_target",
        json!({ "path": path, "target": "main" }),
    );

    assert!(repo.git_fails(&["rebase", "main"]));
    let state = call(&core, "merge_state", json!({ "path": path }));
    assert_eq!(state["operation"], "rebase");
    assert!(!state["conflicts"].as_array().unwrap().is_empty());
    let err = core
        .dispatch("merge_target", json!({ "path": path }))
        .unwrap_err();
    assert!(
        err.message.contains("rebase is in progress"),
        "{}",
        err.message
    );
}

#[test]
fn a_target_that_exists_only_on_the_remote_is_fetched_and_merged() {
    let repo = TempRepo::with_commit();
    repo.bare_remote();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.write("theirs.txt", "t\n");
    repo.commit_all("Theirs");
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["switch", "-q", "-c", "gs/feature", "HEAD~1"]);
    repo.git(&["branch", "-q", "-D", "main"]);
    let (_data, core, path) = open(&repo);
    assert_eq!(
        call(&core, "merge_target", json!({ "path": path })),
        json!({ "status": "merged", "from": "main" })
    );
    assert!(repo.path().join("theirs.txt").exists());
}

#[test]
fn leftover_unresolved_files_block_a_new_merge() {
    let repo = TempRepo::with_commit();
    repo.write("a.txt", "base\n");
    repo.commit_all("Base");
    repo.write("a.txt", "stashed\n");
    repo.git(&["stash", "-q"]);
    repo.write("a.txt", "committed\n");
    repo.commit_all("Change a");
    assert!(repo.git_fails(&["stash", "pop", "-q"]));
    repo.branch("gs/feature");
    let (_data, core, path) = open(&repo);
    call(
        &core,
        "set_target",
        json!({ "path": path, "target": "main" }),
    );
    let err = core
        .dispatch("merge_target", json!({ "path": path }))
        .unwrap_err();
    assert!(
        err.message.contains("unresolved conflicts"),
        "{}",
        err.message
    );
    assert_eq!(
        call(&core, "merge_state", json!({ "path": path }))["operation"],
        Value::Null
    );
}

#[test]
fn a_tag_with_the_targets_name_does_not_replace_the_branch() {
    let repo = TempRepo::with_commit();
    repo.git(&["tag", "release"]);
    repo.branch("release");
    repo.write("release.txt", "r\n");
    repo.commit_all("Release work");
    repo.switch("main");
    repo.branch("gs/feature");
    let (_data, core, path) = open(&repo);
    call(
        &core,
        "set_target",
        json!({ "path": path, "target": "release" }),
    );
    assert_eq!(
        call(&core, "merge_target", json!({ "path": path }))["status"],
        "merged"
    );
    assert!(repo.path().join("release.txt").exists());
}

#[test]
fn a_conflicted_file_reads_its_three_versions_and_applies_a_result() {
    let repo = conflicting();
    let (_data, core, path) = open(&repo);
    call(&core, "merge_target", json!({ "path": path }));
    let file = call(
        &core,
        "merge_file",
        json!({ "path": path, "file": "both.txt" }),
    );
    assert_eq!(file["content"], "text");
    assert_eq!(
        (&file["base"], &file["ours"], &file["theirs"]),
        (&json!("base\n"), &json!("ours\n"), &json!("theirs\n"))
    );
    assert_eq!(file["chunks"].as_array().unwrap().len(), 1);
    assert_eq!(file["chunks"][0]["kind"], "conflict");
    assert_eq!(file["chunks"][0]["combined"], Value::Null);
    assert_eq!(
        call(
            &core,
            "merge_file",
            json!({ "path": path, "file": "gone-here.txt" })
        )["content"],
        "deleted"
    );
    let added = call(
        &core,
        "merge_file",
        json!({ "path": path, "file": "new.txt" }),
    );
    assert_eq!(
        (&added["content"], &added["base"]),
        (&json!("text"), &json!(""))
    );

    call(
        &core,
        "apply_merge",
        json!({ "path": path, "file": "both.txt", "text": "both\n", "crlf": false }),
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("both.txt")).unwrap(),
        "both\n"
    );
    let state = call(&core, "merge_state", json!({ "path": path }));
    assert!(
        !state["conflicts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["path"] == "both.txt")
    );
    let err = core
        .dispatch(
            "apply_merge",
            json!({ "path": path, "file": "../escape.txt", "text": "x", "crlf": false }),
        )
        .unwrap_err();
    assert!(err.message.contains("no conflict"), "{}", err.message);
    assert!(!repo.path().parent().unwrap().join("escape.txt").exists());
}

#[test]
fn line_endings_and_binary_files_are_kept_apart() {
    let repo = TempRepo::new();
    repo.write("win.txt", "a\r\nb\r\n");
    fs::write(repo.path().join("logo.bin"), [0u8, 1, 2]).unwrap();
    repo.commit_all("Base");
    repo.branch("gs/feature");
    repo.write("win.txt", "a\r\nours\r\n");
    fs::write(repo.path().join("logo.bin"), [0u8, 1, 3]).unwrap();
    repo.commit_all("Ours");
    repo.switch("main");
    repo.write("win.txt", "a\r\ntheirs\r\n");
    fs::write(repo.path().join("logo.bin"), [0u8, 1, 4]).unwrap();
    repo.commit_all("Theirs");
    repo.switch("gs/feature");
    let (_data, core, path) = open(&repo);
    call(&core, "merge_target", json!({ "path": path }));
    let win = call(
        &core,
        "merge_file",
        json!({ "path": path, "file": "win.txt" }),
    );
    assert_eq!(win["crlf"], true);
    assert_eq!(win["ours"], "a\nours\n");
    call(
        &core,
        "apply_merge",
        json!({ "path": path, "file": "win.txt", "text": "a\nboth\n", "crlf": true }),
    );
    assert_eq!(
        fs::read(repo.path().join("win.txt")).unwrap(),
        b"a\r\nboth\r\n"
    );
    assert_eq!(
        call(
            &core,
            "merge_file",
            json!({ "path": path, "file": "logo.bin" })
        )["content"],
        "binary"
    );
}

#[test]
fn clean_three_way_merges_match_git_merge_file() {
    let cases = [
        ("a\nb\nc\nd\ne\n", "A\nb\nc\nd\ne\n", "a\nb\nc\nd\nE\n"),
        (
            "a\nb\nc\nd\ne\nf\n",
            "new\na\nb\nc\nd\ne\nf\n",
            "a\nb\nc\nd\ne\n",
        ),
        ("a\nb\nc\n", "a\nX\nc\n", "a\nX\nc\n"),
        (
            "1\n2\n3\n4\n5\n6\n7\n",
            "1\n2\n3\n4\n5\n6\n7\n8\n",
            "0\n1\n2\n3\n4\n5\n6\n7\n",
        ),
    ];
    let dir = tempfile::tempdir().unwrap();
    for (base, ours, theirs) in cases {
        let ours_merged = diffloupe_core::merge3::merged(base, ours, theirs).unwrap();
        for (name, text) in [("base", base), ("ours", ours), ("theirs", theirs)] {
            fs::write(dir.path().join(name), text).unwrap();
        }
        let git = git_in(dir.path(), &["merge-file", "-p", "ours", "base", "theirs"]);
        assert_eq!(ours_merged.trim_end(), git, "{base:?} {ours:?} {theirs:?}");
    }
}

#[test]
fn a_symlink_conflict_is_not_merged_as_text() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    std::os::unix::fs::symlink("a.txt", repo.path().join("link")).unwrap();
    repo.commit_all("Base");
    repo.branch("gs/feature");
    fs::remove_file(repo.path().join("link")).unwrap();
    std::os::unix::fs::symlink("ours.txt", repo.path().join("link")).unwrap();
    repo.commit_all("Ours");
    repo.switch("main");
    fs::remove_file(repo.path().join("link")).unwrap();
    std::os::unix::fs::symlink("theirs.txt", repo.path().join("link")).unwrap();
    repo.commit_all("Theirs");
    repo.switch("gs/feature");
    let (_data, core, path) = open(&repo);
    call(&core, "merge_target", json!({ "path": path }));
    assert_eq!(
        call(&core, "merge_file", json!({ "path": path, "file": "link" }))["content"],
        "link"
    );
    let err = core
        .dispatch(
            "apply_merge",
            json!({ "path": path, "file": "link", "text": "x", "crlf": false }),
        )
        .unwrap_err();
    assert!(err.message.contains("symbolic link"), "{}", err.message);
}
