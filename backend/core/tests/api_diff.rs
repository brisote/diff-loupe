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

fn diff(core: &Core, path: &Value, file: &str, old: Option<&str>) -> Value {
    core.dispatch(
        "diff",
        json!({ "path": path, "file": file, "oldPath": old }),
    )
    .unwrap()
}

fn kinds(diff: &Value) -> Vec<String> {
    diff["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["kind"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_modified_file_has_both_sides_and_its_blocks() {
    let repo = TempRepo::new();
    repo.write("src/Main.kt", "fun main() {\n    val sum = 1\n}\n");
    let head = repo.commit_all("Initial commit");
    repo.write(
        "src/Main.kt",
        "fun main() {\n    val count = 1\n    println(count)\n}\n",
    );
    let (_data, core, _events, path) = open(&repo);
    let d = diff(&core, &path, "src/Main.kt", None);
    assert_eq!(d["content"], "text");
    assert_eq!(d["left"]["text"], "fun main() {\n    val sum = 1\n}\n");
    assert_eq!(d["left"]["revision"], head[..8].to_string());
    assert_eq!(d["right"]["revision"], Value::Null);
    assert_eq!(kinds(&d), ["modified"]);
    assert_eq!(d["blocks"][0]["hasWords"], true);
}

#[test]
fn new_deleted_and_renamed_files() {
    let repo = TempRepo::new();
    repo.write("old.md", "# Title\nBody\n");
    repo.write("gone.txt", "bye\n");
    repo.commit_all("Initial commit");
    repo.git(&["mv", "old.md", "new.md"]);
    repo.write("new.md", "# Title\nBody, edited\n");
    repo.remove("gone.txt");
    repo.write("fresh.txt", "hello\nworld\n");
    let (_data, core, _events, path) = open(&repo);

    let fresh = diff(&core, &path, "fresh.txt", None);
    assert_eq!(fresh["left"]["exists"], false);
    assert_eq!(kinds(&fresh), ["inserted"]);

    let gone = diff(&core, &path, "gone.txt", None);
    assert_eq!(gone["right"]["exists"], false);
    assert_eq!(kinds(&gone), ["deleted"]);

    let renamed = diff(&core, &path, "new.md", Some("old.md"));
    assert_eq!(renamed["left"]["text"], "# Title\nBody\n");
    assert_eq!(kinds(&renamed), ["modified"]);
}

#[test]
fn line_endings_are_normalised_and_reported() {
    let repo = TempRepo::new();
    repo.write("windows.txt", "one\r\ntwo\r\n");
    repo.commit_all("Initial commit");
    repo.write("windows.txt", "one\r\nTWO\r\n");
    let (_data, core, _events, path) = open(&repo);
    let d = diff(&core, &path, "windows.txt", None);
    assert_eq!(d["right"]["crlf"], true);
    assert_eq!(d["right"]["text"], "one\nTWO\n");
    assert_eq!(kinds(&d), ["modified"]);
    assert_eq!(d["blocks"][0]["leftStart"], 1);
}

#[test]
fn binary_files_and_images_get_no_text() {
    let repo = TempRepo::new();
    repo.write("data.bin", "a\0b");
    repo.write("logo.png", "not really a png");
    repo.commit_all("Initial commit");
    repo.write("data.bin", "a\0c");
    repo.write("logo.png", "still not a png");
    let (_data, core, _events, path) = open(&repo);
    let binary = diff(&core, &path, "data.bin", None);
    assert_eq!(binary["content"], "binary");
    assert_eq!(binary["right"]["text"], "");
    assert_eq!(kinds(&binary), Vec::<String>::new());
    assert_eq!(diff(&core, &path, "logo.png", None)["content"], "image");
}

#[test]
fn a_repository_without_commits_compares_with_nothing() {
    let repo = TempRepo::new();
    repo.write("first.txt", "first\n");
    let (_data, core, _events, path) = open(&repo);
    let d = diff(&core, &path, "first.txt", None);
    assert_eq!(d["left"]["exists"], false);
    assert_eq!(d["left"]["revision"], Value::Null);
    assert_eq!(kinds(&d), ["inserted"]);
}

#[test]
fn diffs_follow_edits_and_refuse_other_repositories() {
    let repo = TempRepo::with_commit();
    repo.write("README.md", "# One\n");
    let (_data, core, _events, path) = open(&repo);
    assert_eq!(
        diff(&core, &path, "README.md", None)["right"]["text"],
        "# One\n"
    );
    repo.write("README.md", "# Two, longer\n");
    assert_eq!(
        diff(&core, &path, "README.md", None)["right"]["text"],
        "# Two, longer\n"
    );
    let other = TempRepo::with_commit();
    let err = core
        .dispatch(
            "diff",
            json!({"path": other.path(), "file": "README.md", "oldPath": null}),
        )
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "notOpen");
}

#[test]
fn diffs_are_prepared_in_the_background_with_progress() {
    let repo = TempRepo::with_commit();
    repo.write("README.md", "# Changed\n");
    repo.write("notes.txt", "notes\n");
    let (_data, core, events, path) = open(&repo);
    events.take();
    core.dispatch(
        "prepare_diffs",
        json!({"path": path, "files": [{"file": "README.md", "oldPath": null}, {"file": "notes.txt", "oldPath": null}]}),
    )
    .unwrap();
    let started = Instant::now();
    let mut labels = Vec::new();
    let mut finished = false;
    while started.elapsed() < Duration::from_secs(5) && !finished {
        for event in events.take() {
            if let CoreEvent::Task { label, done, .. } = event {
                finished |= done;
                labels.push(label);
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(finished);
    assert_eq!(
        labels.first().unwrap(),
        "Preparing diffs in acme-billing · 0 of 2 files"
    );
    assert!(labels.contains(&"Preparing diffs in acme-billing · 2 of 2 files".to_string()));
}

#[test]
fn latin1_files_keep_their_letters_and_say_so() {
    let repo = TempRepo::new();
    std::fs::write(repo.path().join("legacy.properties"), b"name=caf\xe9\n").unwrap();
    repo.commit_all("Initial commit");
    std::fs::write(repo.path().join("legacy.properties"), b"name=caf\xe9s\n").unwrap();
    let (_data, core, _events, path) = open(&repo);
    let d = diff(&core, &path, "legacy.properties", None);
    assert_eq!(d["content"], "text");
    assert_eq!(d["right"]["text"], "name=cafés\n");
    assert_eq!(d["right"]["encoding"], "ISO-8859-1");
}

#[test]
fn files_over_the_limit_are_too_large_to_compare() {
    let repo = TempRepo::with_commit();
    repo.write("huge.log", &"x".repeat(21 * 1024 * 1024));
    let (_data, core, _events, path) = open(&repo);
    let d = diff(&core, &path, "huge.log", None);
    assert_eq!(d["content"], "tooLarge");
    assert_eq!(d["right"]["text"], "");
    assert_eq!(d["right"]["exists"], true);
}

#[test]
fn the_whitespace_setting_applies_to_diffs() {
    let repo = TempRepo::new();
    repo.write("a.kt", "fun a() {\n  x = 1\n}\n");
    repo.commit_all("Initial commit");
    repo.write("a.kt", "fun a() {\n    x  =  1\n}\n");
    let (_data, core, _events, path) = open(&repo);
    assert_eq!(kinds(&diff(&core, &path, "a.kt", None)), ["modified"]);
    let mut settings = core.dispatch("get_settings", Value::Null).unwrap();
    settings["diff"]["whitespace"] = json!("ignore");
    core.dispatch("set_settings", json!({ "settings": settings }))
        .unwrap();
    let ignored = diff(&core, &path, "a.kt", None);
    assert_eq!(kinds(&ignored), Vec::<String>::new());
    assert_eq!(ignored["right"]["text"], "fun a() {\n    x  =  1\n}\n");
}

fn area_diff(core: &Core, path: &Value, file: &str, old: Option<&str>, area: &str) -> Value {
    core.dispatch(
        "diff",
        json!({ "path": path, "file": file, "oldPath": old, "area": area }),
    )
    .unwrap()
}

#[test]
fn a_staged_file_edited_again_shows_the_staged_part_and_the_later_edit_apart() {
    let repo = TempRepo::with_commit();
    repo.write("notes_v1.md", "# Notes\nFirst line\n");
    repo.git(&["add", "notes_v1.md"]);
    repo.write("notes_v1.md", "# Notes\nFirst line\nAdded after staging\n");
    let (_data, core, _events, path) = open(&repo);

    let staged = area_diff(&core, &path, "notes_v1.md", None, "staged");
    assert_eq!(staged["left"]["exists"], false);
    assert_eq!(staged["right"]["text"], "# Notes\nFirst line\n");
    assert_eq!(staged["right"]["title"], "Staged version");
    assert_eq!(kinds(&staged), ["inserted"]);

    let unstaged = area_diff(&core, &path, "notes_v1.md", None, "unstaged");
    assert_eq!(unstaged["left"]["text"], "# Notes\nFirst line\n");
    assert_eq!(unstaged["left"]["title"], "Staged version");
    assert_eq!(
        unstaged["right"]["text"],
        "# Notes\nFirst line\nAdded after staging\n"
    );
    assert_eq!(kinds(&unstaged), ["inserted"]);
    assert_eq!(unstaged["blocks"][0]["rightStart"], 2);

    let whole = diff(&core, &path, "notes_v1.md", None);
    assert_eq!(whole["left"]["exists"], false);
    assert_eq!(
        whole["right"]["text"],
        "# Notes\nFirst line\nAdded after staging\n"
    );
}

#[test]
fn staged_renames_and_deletions_compare_the_right_files() {
    let repo = TempRepo::new();
    repo.write("old.md", "# Title\nBody\n");
    repo.write("gone.txt", "bye\n");
    repo.commit_all("Initial commit");
    repo.git(&["mv", "old.md", "new.md"]);
    repo.write("new.md", "# Title\nBody\nMore\n");
    repo.git(&["rm", "-q", "gone.txt"]);
    let (_data, core, _events, path) = open(&repo);

    let staged = area_diff(&core, &path, "new.md", Some("old.md"), "staged");
    assert_eq!(staged["left"]["text"], "# Title\nBody\n");
    assert_eq!(staged["right"]["text"], "# Title\nBody\n");
    assert!(kinds(&staged).is_empty());
    let unstaged = area_diff(&core, &path, "new.md", Some("old.md"), "unstaged");
    assert_eq!(unstaged["left"]["text"], "# Title\nBody\n");
    assert_eq!(unstaged["oldPath"], Value::Null);
    assert_eq!(kinds(&unstaged), ["inserted"]);

    let deleted = area_diff(&core, &path, "gone.txt", None, "staged");
    assert_eq!(deleted["left"]["text"], "bye\n");
    assert_eq!(deleted["right"]["exists"], false);
}

#[test]
fn a_staged_diff_follows_git_add() {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("Initial commit");
    repo.write("a.txt", "two\n");
    repo.git(&["add", "a.txt"]);
    let (_data, core, _events, path) = open(&repo);
    assert_eq!(
        area_diff(&core, &path, "a.txt", None, "staged")["right"]["text"],
        "two\n"
    );
    std::thread::sleep(Duration::from_millis(20));
    repo.write("a.txt", "three\n");
    repo.git(&["add", "a.txt"]);
    assert_eq!(
        area_diff(&core, &path, "a.txt", None, "staged")["right"]["text"],
        "three\n"
    );
}

#[test]
fn autocrlf_and_gitattributes_eol_report_only_the_edited_line() {
    let repo = TempRepo::new();
    repo.git(&["config", "core.autocrlf", "true"]);
    repo.write(".gitattributes", "* text=auto eol=crlf\n");
    repo.write("readme.txt", "one\r\ntwo\r\nthree\r\n");
    repo.commit_all("Initial commit");
    let (_data, core, _events, path) = open(&repo);
    let clean = core.dispatch("status", json!({ "path": path })).unwrap();
    assert_eq!(clean, json!([]));
    let clean_diff = diff(&core, &path, "readme.txt", None);
    assert!(kinds(&clean_diff).is_empty());
    assert_eq!(clean_diff["left"]["crlf"], clean_diff["right"]["crlf"]);

    repo.write("readme.txt", "one\r\nTWO\r\nthree\r\n");
    let status = core.dispatch("status", json!({ "path": path })).unwrap();
    assert_eq!(status.as_array().unwrap().len(), 1);
    assert_eq!(status[0]["path"], "readme.txt");
    let d = diff(&core, &path, "readme.txt", None);
    assert_eq!(d["left"]["crlf"], false);
    assert_eq!(d["right"]["crlf"], false);
    assert_eq!(d["left"]["text"], "one\ntwo\nthree\n");
    assert_eq!(d["right"]["text"], "one\nTWO\nthree\n");
    assert_eq!(kinds(&d), ["modified"]);
    assert_eq!(d["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(d["blocks"][0]["leftStart"], 1);
    assert_eq!(d["blocks"][0]["leftEnd"], 2);
    assert_eq!(d["blocks"][0]["rightStart"], 1);
    assert_eq!(d["blocks"][0]["rightEnd"], 2);
}
