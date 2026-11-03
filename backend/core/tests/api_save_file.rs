#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::RecordedEvents;
use diffloupe_core::testutil::{TempRepo, test_env};
use serde_json::{Value, json};
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

#[test]
fn save_file_updates_existing_file_content() {
    let repo = TempRepo::new();
    repo.write("src/Main.kt", "fun main() {\n    println(1)\n}\n");
    repo.commit_all("Initial commit");
    let (_data, core, _events, path) = open(&repo);

    let updated = "fun main() {\n    println(2)\n}\n";
    core.dispatch(
        "save_file",
        json!({
            "path": path,
            "file": "src/Main.kt",
            "text": updated,
        }),
    )
    .unwrap();

    let on_disk = std::fs::read_to_string(repo.path().join("src/Main.kt")).unwrap();
    assert_eq!(on_disk, updated);

    let d = core
        .dispatch(
            "diff",
            json!({
                "path": path,
                "file": "src/Main.kt",
                "local": true,
            }),
        )
        .unwrap();
    assert_eq!(d["right"]["text"], updated);
}

#[test]
fn save_file_creates_nested_file() {
    let repo = TempRepo::new();
    repo.write("README.md", "# Test\n");
    repo.commit_all("Initial commit");
    let (_data, core, _events, path) = open(&repo);

    let content = "new nested content\n";
    core.dispatch(
        "save_file",
        json!({
            "path": path,
            "file": "nested/dir/new_file.txt",
            "text": content,
        }),
    )
    .unwrap();

    let on_disk = std::fs::read_to_string(repo.path().join("nested/dir/new_file.txt")).unwrap();
    assert_eq!(on_disk, content);
}

#[test]
fn save_file_rejects_escaping_repository() {
    let repo = TempRepo::new();
    repo.write("README.md", "# Test\n");
    repo.commit_all("Initial commit");
    let (_data, core, _events, path) = open(&repo);

    let res = core.dispatch(
        "save_file",
        json!({
            "path": path,
            "file": "../outside.txt",
            "text": "evil",
        }),
    );
    assert!(res.is_err());
    assert!(!repo.path().join("../outside.txt").exists());
}

#[test]
fn save_file_rejects_when_repo_not_open() {
    let repo = TempRepo::new();
    repo.write("README.md", "# Test\n");
    repo.commit_all("Initial commit");
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events).unwrap();

    let res = core.dispatch(
        "save_file",
        json!({
            "path": repo.path().to_str().unwrap(),
            "file": "README.md",
            "text": "should fail",
        }),
    );
    assert!(res.is_err());
}
