#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, RecordedEvents};
use diffloupe_core::testutil::{TempRepo, test_env};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn open(repo: &TempRepo) -> (tempfile::TempDir, Core, Arc<RecordedEvents>) {
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    core.dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    (data, core, events)
}

fn status(core: &Core) -> Vec<Value> {
    let path = core.dispatch("current_repo", Value::Null).unwrap()["path"].clone();
    core.dispatch("status", json!({ "path": path }))
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

fn kinds(changes: &[Value]) -> Vec<(String, String)> {
    let mut list: Vec<_> = changes
        .iter()
        .map(|c| {
            (
                c["path"].as_str().unwrap().to_string(),
                c["kind"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    list.sort();
    list
}

fn changed_within(events: &RecordedEvents, wait: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < wait {
        if events
            .take()
            .iter()
            .any(|event| matches!(event, CoreEvent::RepoChanged { .. }))
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

#[test]
fn status_lists_every_kind_of_change() {
    let repo = TempRepo::new();
    repo.write("README.md", "# Acme\n");
    repo.write("billing/Invoice.kt", "class Invoice\n");
    repo.write("old name.txt", "same\n");
    repo.write("legacy.yaml", "a: 1\n");
    repo.commit_all("Initial commit");

    repo.write("README.md", "# Acme billing\n");
    repo.remove("legacy.yaml");
    repo.git(&["mv", "old name.txt", "new name.txt"]);
    repo.write("staged.txt", "new\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("web/src/exportButton.tsx", "export {}\n");
    repo.write("notes/über café.md", "unicode\n");

    let (_data, core, _events) = open(&repo);
    let changes = status(&core);
    assert_eq!(
        kinds(&changes),
        [
            ("README.md".into(), "modified".into()),
            ("legacy.yaml".into(), "deleted".into()),
            ("new name.txt".into(), "renamed".into()),
            ("notes/über café.md".into(), "untracked".into()),
            ("staged.txt".into(), "added".into()),
            ("web/src/exportButton.tsx".into(), "untracked".into()),
        ]
    );
    let renamed = changes.iter().find(|c| c["kind"] == "renamed").unwrap();
    assert_eq!(renamed["oldPath"], "old name.txt");
    assert_eq!(renamed["staged"], true);
}

#[test]
fn a_clean_tree_has_no_changes_and_ignored_files_stay_out() {
    let repo = TempRepo::with_commit();
    repo.write(".gitignore", "target/\n");
    repo.commit_all("Ignore build output");
    repo.write("target/debug/app", "binary\n");
    let (_data, core, _events) = open(&repo);
    assert!(status(&core).is_empty());
}

#[test]
fn status_needs_an_open_repository() {
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(RecordedEvents::default())).unwrap();
    let repo = TempRepo::with_commit();
    let err = core
        .dispatch("status", json!({ "path": repo.path() }))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "noRepository");
}

#[test]
fn status_refuses_a_repository_that_is_not_open() {
    let first = TempRepo::with_commit();
    let second = TempRepo::with_commit();
    let (_data, core, _events) = open(&first);
    let err = core
        .dispatch("status", json!({ "path": second.path() }))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "notOpen");
}

#[test]
fn the_first_read_belongs_to_opening() {
    let repo = TempRepo::with_commit();
    let (_data, core, events) = open(&repo);
    events.take();
    status(&core);
    status(&core);
    let labels: Vec<String> = events
        .take()
        .into_iter()
        .filter_map(|event| match event {
            CoreEvent::Task {
                label, done: false, ..
            } => Some(label),
            _ => None,
        })
        .collect();
    assert_eq!(
        labels,
        [
            "Opening acme-billing · reading changes",
            "Reading changes in acme-billing"
        ]
    );
}

#[test]
fn the_chosen_target_is_remembered_per_repository() {
    let repo = TempRepo::with_commit();
    repo.git(&["branch", "develop"]);
    repo.branch("gs/feature");
    let (_data, core, _events) = open(&repo);
    let path = core.dispatch("current_repo", Value::Null).unwrap()["path"].clone();
    core.dispatch("set_target", json!({"path": path, "target": "develop"}))
        .unwrap();
    let info = core
        .dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    assert_eq!(info["target"], "develop");
    assert_eq!(info["defaultBranch"], "main");
    core.dispatch("set_target", json!({"path": path, "target": null}))
        .unwrap();
    let info = core.dispatch("current_repo", Value::Null).unwrap();
    assert_eq!(info["target"], "main");
}

#[test]
fn merging_the_current_branch_into_itself_is_refused() {
    let repo = TempRepo::with_commit();
    let (_data, core, _events) = open(&repo);
    let path = core.dispatch("current_repo", Value::Null).unwrap()["path"].clone();
    let error = core
        .dispatch("merge_target", json!({ "path": path }))
        .unwrap_err();
    assert!(
        error.message.contains("target is the current branch"),
        "{}",
        error.message
    );
}

#[test]
fn editing_a_file_reports_a_change() {
    let repo = TempRepo::with_commit();
    let (_data, _core, events) = open(&repo);
    std::thread::sleep(Duration::from_millis(300));
    events.take();
    repo.write("README.md", "# Changed\n");
    assert!(changed_within(&events, Duration::from_secs(1)));
}

#[test]
fn a_commit_reports_a_change() {
    let repo = TempRepo::with_commit();
    repo.write("README.md", "# Changed\n");
    let (_data, _core, events) = open(&repo);
    std::thread::sleep(Duration::from_millis(300));
    events.take();
    repo.git(&["commit", "-q", "-am", "Change"]);
    assert!(changed_within(&events, Duration::from_secs(1)));
}

#[test]
fn ignored_folders_do_not_report_changes() {
    let repo = TempRepo::with_commit();
    repo.write(".gitignore", "target/\n");
    repo.commit_all("Ignore build output");
    repo.write("target/keep", "x\n");
    let (_data, _core, events) = open(&repo);
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    repo.write("target/debug/app", "binary\n");
    repo.write("target/debug/deps/lib.rlib", "binary\n");
    assert!(!changed_within(&events, Duration::from_millis(800)));
}

#[test]
fn a_huge_ignored_batch_neither_refreshes_nor_stops_the_watcher() {
    let repo = TempRepo::with_commit();
    repo.write(".gitignore", "target/\n");
    repo.commit_all("Ignore build output");
    repo.write("target/keep", "x\n");
    let (_data, _core, events) = open(&repo);
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    for i in 0..4000 {
        repo.write(
            &format!("target/debug/deps/a-very-long-build-artifact-name-{i:05}.rlib"),
            "b",
        );
    }
    assert!(!changed_within(&events, Duration::from_millis(1500)));
    repo.write("README.md", "# still watching\n");
    assert!(changed_within(&events, Duration::from_secs(2)));
}

#[test]
fn deleting_an_ignored_folder_does_not_report_a_change() {
    let repo = TempRepo::with_commit();
    repo.write(".gitignore", "target/\n");
    repo.commit_all("Ignore build output");
    repo.write("target/debug/app", "binary\n");
    let (_data, _core, events) = open(&repo);
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    std::fs::remove_dir_all(repo.path().join("target")).unwrap();
    assert!(!changed_within(&events, Duration::from_millis(800)));
}

#[test]
fn a_linked_worktree_sees_ref_changes_in_the_main_repository() {
    let repo = TempRepo::with_commit();
    let worktree = repo.path().with_file_name("feature-worktree");
    repo.git(&[
        "worktree",
        "add",
        "-q",
        "-b",
        "feature",
        &worktree.display().to_string(),
    ]);
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    let info = core
        .dispatch("open_repo", json!({"path": worktree}))
        .unwrap();
    assert_eq!(info["branch"], "feature");
    assert_eq!(info["watchError"], Value::Null);
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    repo.git(&["branch", "release"]);
    assert!(changed_within(&events, Duration::from_secs(1)));
}

#[test]
fn target_and_view_paths_are_stored_canonically() {
    let repo = TempRepo::with_commit();
    repo.git(&["branch", "develop"]);
    repo.branch("gs/feature");
    let (_data, core, _events) = open(&repo);
    let spelled = format!("{}/./", repo.path().display());
    core.dispatch("set_target", json!({"path": spelled, "target": "develop"}))
        .unwrap();
    core.dispatch(
        "set_repo_view",
        json!({"path": spelled, "tab": "log", "selection": null}),
    )
    .unwrap();
    let info = core.dispatch("current_repo", Value::Null).unwrap();
    assert_eq!(info["target"], "develop");
    assert_eq!(info["lastTab"], "log");
    let err = core
        .dispatch(
            "set_target",
            json!({"path": "/no/such/repo", "target": "x"}),
        )
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "notFound");
}

#[test]
fn deleting_a_tracked_file_inside_an_ignored_folder_reports_a_change() {
    let repo = TempRepo::with_commit();
    repo.write(".gitignore", "dist/\n");
    repo.write("dist/keep.js", "kept\n");
    repo.git(&["add", ".gitignore"]);
    repo.git(&["add", "-f", "dist/keep.js"]);
    repo.git(&["commit", "-q", "-m", "Vendor a file"]);
    let (_data, _core, events) = open(&repo);
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    std::fs::remove_file(repo.path().join("dist/keep.js")).unwrap();
    assert!(changed_within(&events, Duration::from_secs(1)));
}

#[test]
fn build_output_in_a_submodule_is_ignored_but_edits_are_not() {
    let library = TempRepo::with_commit();
    library.write(".gitignore", "target/\n");
    library.commit_all("Ignore build output");
    let repo = TempRepo::with_commit();
    repo.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        &library.path().display().to_string(),
        "lib",
    ]);
    repo.git(&["commit", "-q", "-m", "Add the library"]);
    let (_data, _core, events) = open(&repo);
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    repo.write("lib/target/debug/app", "binary\n");
    assert!(!changed_within(&events, Duration::from_millis(800)));
    repo.write("lib/README.md", "# changed inside the submodule\n");
    assert!(changed_within(&events, Duration::from_secs(1)));
}

#[test]
fn a_linked_worktree_ignores_the_main_checkouts_index() {
    let repo = TempRepo::with_commit();
    let worktree = repo.path().with_file_name("feature-worktree-2");
    repo.git(&[
        "worktree",
        "add",
        "-q",
        "-b",
        "feature",
        &worktree.display().to_string(),
    ]);
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    core.dispatch("open_repo", json!({"path": worktree}))
        .unwrap();
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    repo.write("staged.txt", "x\n");
    repo.git(&["add", "staged.txt"]);
    assert!(!changed_within(&events, Duration::from_millis(800)));
}

fn branched() -> TempRepo {
    let repo = TempRepo::new();
    repo.write("Totals.kt", "val total = 1\n");
    repo.write("Legacy.kt", "old\n");
    repo.write(
        "csv/Writer.kt",
        "class Writer\nfun write() = 1\nfun close() = 2\n",
    );
    repo.commit_all("Base");
    repo.branch("gs/export");
    repo.write("Totals.kt", "val total = 2\n");
    repo.remove("Legacy.kt");
    repo.remove("csv/Writer.kt");
    repo.write(
        "export/Writer.kt",
        "class Writer\nfun write() = 1\nfun close() = 2\n",
    );
    repo.write("Export.kt", "fun export() = 1\n");
    repo.commit_all("Export on the branch");
    repo.switch("main");
    repo.write("Main.kt", "fun main() = 1\n");
    repo.commit_all("Main moves on");
    repo.switch("gs/export");
    repo.write("Export.kt", "fun export() = 2\n");
    repo.write("draft.txt", "notes\n");
    repo
}

fn summary(changes: &[Value]) -> Vec<(String, String, bool)> {
    let mut list: Vec<_> = changes
        .iter()
        .map(|c| {
            (
                c["path"].as_str().unwrap().to_string(),
                c["kind"].as_str().unwrap().to_string(),
                c["staged"] == true || c["unstaged"] == true,
            )
        })
        .collect();
    list.sort();
    list
}

#[test]
fn changes_compare_the_working_tree_with_the_merge_base_of_the_target() {
    let repo = branched();
    let (_data, core, _events) = open(&repo);
    let changes = status(&core);
    let owned = |path: &str, kind: &str, local: bool| (path.to_string(), kind.to_string(), local);
    assert_eq!(
        summary(&changes),
        [
            owned("Export.kt", "added", true),
            owned("Legacy.kt", "deleted", false),
            owned("Totals.kt", "modified", false),
            owned("draft.txt", "untracked", true),
            owned("export/Writer.kt", "renamed", false),
        ]
    );
    let renamed = changes
        .iter()
        .find(|c| c["path"] == "export/Writer.kt")
        .unwrap();
    assert_eq!(renamed["oldPath"], "csv/Writer.kt");
    assert_eq!(renamed["headPath"], Value::Null);

    let path = core.dispatch("current_repo", Value::Null).unwrap()["path"].clone();
    let base = repo.git(&["merge-base", "HEAD", "main"]);
    let diff = core
        .dispatch(
            "diff",
            json!({ "path": path, "file": "Totals.kt", "oldPath": null }),
        )
        .unwrap();
    assert_eq!(diff["left"]["text"], "val total = 1\n");
    assert_eq!(diff["right"]["text"], "val total = 2\n");
    assert_eq!(diff["left"]["revision"], &base[..8]);
    let added = core
        .dispatch(
            "diff",
            json!({ "path": path, "file": "Export.kt", "oldPath": null }),
        )
        .unwrap();
    assert_eq!(added["left"]["text"], "");
    assert_eq!(added["right"]["text"], "fun export() = 2\n");
}

#[test]
fn the_branch_itself_or_a_missing_target_compares_with_head() {
    let repo = branched();
    let (_data, core, _events) = open(&repo);
    let path = core.dispatch("current_repo", Value::Null).unwrap()["path"].clone();
    core.dispatch("set_target", json!({ "path": path, "target": "nowhere" }))
        .unwrap();
    let local = [
        ("Export.kt".to_string(), "modified".to_string(), true),
        ("draft.txt".to_string(), "untracked".to_string(), true),
    ];
    assert_eq!(summary(&status(&core)), local);
    let diff = core
        .dispatch(
            "diff",
            json!({ "path": path, "file": "Export.kt", "oldPath": null }),
        )
        .unwrap();
    assert_eq!(diff["left"]["text"], "fun export() = 1\n");
    core.dispatch("set_target", json!({ "path": path, "target": "gs/export" }))
        .unwrap();
    assert_eq!(summary(&status(&core)), local);
    core.dispatch("set_target", json!({ "path": path, "target": "main" }))
        .unwrap();
    assert_eq!(status(&core).len(), 5);
}

#[test]
fn during_a_merge_the_targets_own_changes_stay_out() {
    let repo = branched();
    repo.write("Totals.kt", "val total = 3\n");
    repo.git(&["checkout", "--", "Export.kt"]);
    repo.commit_all("More on the branch");
    repo.switch("main");
    repo.write("Totals.kt", "val total = 4\n");
    repo.commit_all("Main changes totals");
    repo.switch("gs/export");
    let (_data, core, _events) = open(&repo);
    let path = core.dispatch("current_repo", Value::Null).unwrap()["path"].clone();
    let outcome = core
        .dispatch("merge_target", json!({ "path": path }))
        .unwrap();
    assert_eq!(outcome["status"], "conflicts");
    let changes = status(&core);
    let shown: Vec<&str> = changes
        .iter()
        .filter(|c| c["unchanged"] == false)
        .map(|c| c["path"].as_str().unwrap())
        .collect();
    assert!(!shown.contains(&"Main.kt"), "{shown:?}");
    assert!(shown.contains(&"Totals.kt"), "{shown:?}");
    let merged = changes.iter().find(|c| c["path"] == "Main.kt").unwrap();
    assert_eq!(merged["unchanged"], true);
    assert_eq!(merged["staged"], true);
    let totals = status(&core)
        .into_iter()
        .find(|c| c["path"] == "Totals.kt")
        .unwrap();
    assert_eq!(totals["kind"], "conflicted");
}

#[test]
fn a_quick_read_leaves_untracked_files_for_the_full_read() {
    let repo = branched();
    let (_data, core, _events) = open(&repo);
    let path = core.dispatch("current_repo", Value::Null).unwrap()["path"].clone();
    let quick = core
        .dispatch("status", json!({ "path": path, "untracked": "skip" }))
        .unwrap();
    let paths: Vec<&str> = quick
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["path"].as_str().unwrap())
        .collect();
    assert!(paths.contains(&"Export.kt"), "{paths:?}");
    assert!(!paths.contains(&"draft.txt"), "{paths:?}");
    let full = summary(&status(&core));
    assert!(
        full.iter()
            .any(|(path, kind, _)| path == "draft.txt" && kind == "untracked")
    );
}

#[test]
fn a_full_watch_limit_falls_back_to_slow_polling_that_still_sees_changes() {
    let repo = TempRepo::with_commit();
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    core.set_watch_polling(true);
    let info = core
        .dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    assert_eq!(info["watchPolling"], true);
    assert_eq!(info["watchError"], Value::Null);
    std::thread::sleep(Duration::from_millis(400));
    events.take();
    let seen = (0..12).any(|round| {
        repo.write("README.md", &format!("# seen by polling {round}\n"));
        changed_within(&events, Duration::from_millis(2000))
    });
    assert!(seen, "polling never reported the change");
}

#[test]
fn a_normal_watcher_does_not_report_polling() {
    let repo = TempRepo::with_commit();
    let (_data, core, _events) = open(&repo);
    let info = core.dispatch("current_repo", Value::Null).unwrap();
    assert_eq!(info["watchPolling"], false);
}
