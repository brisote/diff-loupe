#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, RecordedEvents};
use diffloupe_core::testutil::{TempRepo, test_env};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn open(repo: &TempRepo) -> (tempfile::TempDir, Core, Arc<RecordedEvents>, Value) {
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    let info = core
        .dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    (data, core, events, info["path"].clone())
}

fn log(core: &Core, path: &Value) -> Vec<Value> {
    core.dispatch("branch_log", json!({ "path": path }))
        .unwrap()["entries"]
        .as_array()
        .unwrap()
        .clone()
}

fn subjects(entries: &[Value]) -> Vec<&str> {
    entries
        .iter()
        .map(|e| e["subject"].as_str().unwrap())
        .collect()
}

fn branch_with_conflict_fix() -> TempRepo {
    let repo = TempRepo::new();
    repo.write("src/Invoice.kt", "val total = 1\nval tax = 0\n");
    repo.commit_all("Add invoice");
    repo.branch("gs/invoice-export");
    repo.write("src/Invoice.kt", "val total = 2\nval tax = 0\n");
    repo.write("src/Export.kt", "fun export() {}\n");
    repo.commit_all("Export invoices as CSV");
    repo.switch("main");
    repo.write("src/Invoice.kt", "val total = 3\nval tax = 0\n");
    repo.write("docs/Tax.md", "# Tax\n");
    repo.commit_all("Change the total on main");
    repo.switch("gs/invoice-export");
    assert!(repo.git_fails(&["merge", "-q", "main"]));
    repo.write("src/Invoice.kt", "val total = 5\nval tax = 0\n");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-q", "--no-edit"]);
    repo.write("src/Export.kt", "fun export() = Unit\n");
    repo.commit_all("Tidy the export");
    repo
}

#[test]
fn the_log_lists_the_branch_history_with_merges_as_normal_rows() {
    let repo = branch_with_conflict_fix();
    let (_data, core, events, path) = open(&repo);
    let entries = log(&core, &path);
    assert_eq!(
        subjects(&entries),
        [
            "Tidy the export",
            "Merge branch 'main' into gs/invoice-export",
            "Export invoices as CSV",
            "Add invoice"
        ]
    );
    assert_eq!(entries[1]["merge"], true);
    assert_eq!(entries[2]["merge"], false);
    assert!(entries[2].get("files").is_none());
    assert_eq!(entries[2]["author"], "Ada Lovelace");
    assert_eq!(entries[2]["short"].as_str().unwrap().len(), 8);
    assert!(entries[0].get("merged").is_none());
    assert!(events.take().iter().any(|event| matches!(
        event,
        CoreEvent::Task { label, .. } if label == "Reading branch history"
    )));
}

#[test]
fn a_merge_commit_shows_its_changes_against_its_first_parent() {
    let repo = branch_with_conflict_fix();
    let (_data, core, _events, path) = open(&repo);
    let merge = log(&core, &path)[1]["id"].clone();
    let details = core
        .dispatch("commit_details", json!({ "path": path, "id": merge }))
        .unwrap();
    assert_eq!(details["parents"].as_array().unwrap().len(), 2);
    let files: Vec<&str> = details["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert_eq!(files, ["docs/Tax.md", "src/Invoice.kt"]);
    let diff = core
        .dispatch(
            "diff",
            json!({ "path": path, "file": "src/Invoice.kt", "commit": merge }),
        )
        .unwrap();
    assert_eq!(diff["left"]["text"], "val total = 2\nval tax = 0\n");
    assert_eq!(diff["right"]["text"], "val total = 5\nval tax = 0\n");
    assert_eq!(diff["right"]["revision"], merge.as_str().unwrap()[..8]);
}

#[test]
fn a_new_branch_lists_the_history_it_starts_from() {
    let repo = TempRepo::with_commit();
    repo.branch("gs/empty");
    let (_data, core, _events, path) = open(&repo);
    assert_eq!(subjects(&log(&core, &path)), ["Initial commit"]);
}

#[test]
fn a_repository_without_commits_has_an_empty_log() {
    let repo = TempRepo::new();
    let (_data, core, _events, path) = open(&repo);
    assert!(log(&core, &path).is_empty());
}

#[test]
fn the_target_does_not_change_the_log() {
    let repo = TempRepo::with_commit();
    repo.branch("develop");
    repo.write("d.txt", "d\n");
    repo.commit_all("Develop work");
    repo.branch("gs/feature");
    repo.write("f.txt", "f\n");
    repo.commit_all("Feature work");
    let (_data, core, _events, path) = open(&repo);
    let all = ["Feature work", "Develop work", "Initial commit"];
    assert_eq!(subjects(&log(&core, &path)), all);
    for target in ["develop", "nowhere"] {
        core.dispatch("set_target", json!({ "path": path, "target": target }))
            .unwrap();
        assert_eq!(subjects(&log(&core, &path)), all);
    }
}

#[test]
fn a_commit_diff_compares_the_commit_with_its_parent() {
    let repo = TempRepo::with_commit();
    repo.branch("gs/feature");
    repo.write("README.md", "# Acme billing\nMore\n");
    repo.write("new.txt", "new\n");
    let id = repo.commit_all("Edit the readme");
    repo.write("README.md", "# Changed later\n");
    let (_data, core, _events, path) = open(&repo);
    let details = core
        .dispatch("commit_details", json!({ "path": path, "id": id }))
        .unwrap();
    assert_eq!(details["subject"], "Edit the readme");
    assert_eq!(details["email"], "ada@example.com");
    let kinds: Vec<(&str, &str)> = details["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| (f["path"].as_str().unwrap(), f["kind"].as_str().unwrap()))
        .collect();
    assert_eq!(kinds, [("README.md", "modified"), ("new.txt", "added")]);
    let diff = core
        .dispatch(
            "diff",
            json!({ "path": path, "file": "README.md", "commit": id }),
        )
        .unwrap();
    assert_eq!(diff["left"]["text"], "# Acme billing\n");
    assert_eq!(diff["right"]["text"], "# Acme billing\nMore\n");
    assert_eq!(diff["right"]["revision"], &id[..8]);
}

#[test]
fn the_first_commit_compares_with_nothing() {
    let repo = TempRepo::new();
    repo.write("a.txt", "a\n");
    let id = repo.commit_all("First");
    let (_data, core, _events, path) = open(&repo);
    let diff = core
        .dispatch(
            "diff",
            json!({ "path": path, "file": "a.txt", "commit": id }),
        )
        .unwrap();
    assert_eq!(diff["left"]["exists"], false);
    assert_eq!(diff["right"]["text"], "a\n");
}

#[test]
fn a_bad_commit_id_is_refused() {
    let repo = TempRepo::with_commit();
    let (_data, core, _events, path) = open(&repo);
    let err = core
        .dispatch("commit_details", json!({ "path": path, "id": "nope" }))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "invalidArgs");
}

fn import_commits(repo: &TempRepo, branch: &str, count: i64) {
    let script: String = (0..count)
        .map(|n| {
            let message = format!("Commit {n}\n");
            let content = format!("{n}\n");
            format!(
                "commit refs/heads/{branch}\ncommitter Ada <ada@example.com> {} +0000\ndata {}\n{message}M 100644 inline f{n}.txt\ndata {}\n{content}\n",
                1_700_000_000 + n,
                message.len(),
                content.len()
            )
        })
        .collect();
    let base = repo.git(&["rev-parse", "main"]);
    let base = base.trim();
    let script = format!("reset refs/heads/{branch}\nfrom {base}\n\n{script}");
    let mut child = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["fast-import", "--quiet", "--force"])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(script.as_bytes())
        .unwrap();
    assert!(child.wait().unwrap().success());
    repo.git(&["reset", "-q", "--hard"]);
}

#[test]
fn five_hundred_commits_load_fast() {
    let repo = TempRepo::with_commit();
    repo.branch("gs/long");
    import_commits(&repo, "gs/long", 500);
    let (_data, core, _events, path) = open(&repo);
    let start = Instant::now();
    let entries = log(&core, &path);
    let took = start.elapsed();
    assert_eq!(entries.len(), 500);
    let limit = if std::env::var("CI").is_ok() {
        450
    } else {
        150
    };
    assert!(took < Duration::from_millis(limit), "took {took:?}");
}

#[test]
fn a_renamed_file_keeps_its_old_path() {
    let repo = TempRepo::with_commit();
    repo.write(
        "src/Old.kt",
        "class Invoice {\n    val total = 1\n    val tax = 2\n}\n",
    );
    repo.commit_all("Add old");
    repo.branch("gs/rename");
    repo.git(&["mv", "src/Old.kt", "src/New.kt"]);
    let id = repo.commit_all("Rename");
    let (_data, core, _events, path) = open(&repo);
    let details = core
        .dispatch("commit_details", json!({ "path": path, "id": id }))
        .unwrap();
    assert_eq!(
        details["files"],
        json!([{ "path": "src/New.kt", "oldPath": "src/Old.kt", "kind": "renamed" }])
    );
    let diff = core
        .dispatch(
            "diff",
            json!({ "path": path, "file": "src/New.kt", "oldPath": "src/Old.kt", "commit": id }),
        )
        .unwrap();
    assert_eq!(diff["blocks"], json!([]));
}

#[test]
fn the_log_is_read_again_only_when_history_moves() {
    let repo = branch_with_conflict_fix();
    let (_data, core, events, path) = open(&repo);
    log(&core, &path);
    events.take();
    log(&core, &path);
    assert!(
        !events
            .take()
            .iter()
            .any(|e| matches!(e, CoreEvent::Task { .. }))
    );
    repo.write("new.txt", "new\n");
    repo.commit_all("Add new");
    assert_eq!(subjects(&log(&core, &path))[0], "Add new");
}

#[test]
fn the_default_branch_lists_its_own_history_newest_first() {
    let repo = TempRepo::with_commit();
    repo.write("b.txt", "b\n");
    repo.commit_all("Second");
    let (_data, core, _events, path) = open(&repo);
    let log = core
        .dispatch("branch_log", json!({ "path": path }))
        .unwrap();
    assert!(log.get("target").is_none());
    assert_eq!(log["truncated"], false);
    let entries = log["entries"].as_array().unwrap();
    assert_eq!(subjects(entries)[0], "Second");
    assert_eq!(entries.len(), 2);
}

#[test]
fn a_stored_target_equal_to_the_current_branch_is_kept() {
    let repo = TempRepo::with_commit();
    repo.branch("gs/feature");
    let (_data, core, _events, path) = open(&repo);
    core.dispatch(
        "set_target",
        json!({ "path": path, "target": "gs/feature" }),
    )
    .unwrap();
    let info = core.dispatch("open_repo", json!({ "path": path })).unwrap();
    assert_eq!(info["target"], "gs/feature");
    assert_eq!(info["branch"], "gs/feature");
}

#[test]
fn a_long_default_branch_shows_its_latest_five_hundred_commits() {
    let repo = TempRepo::with_commit();
    import_commits(&repo, "main", 600);
    let (_data, core, _events, path) = open(&repo);
    let start = Instant::now();
    let log = core
        .dispatch("branch_log", json!({ "path": path }))
        .unwrap();
    let took = start.elapsed();
    let entries = log["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 500);
    assert_eq!(log["truncated"], true);
    assert_eq!(entries[0]["subject"], "Commit 599");
    let limit = if std::env::var("CI").is_ok() {
        450
    } else {
        150
    };
    assert!(took < Duration::from_millis(limit), "took {took:?}");
}
