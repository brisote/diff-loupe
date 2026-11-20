#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::NoEvents;
use diffloupe_core::testutil::{TempRepo, test_env};
use serde_json::{Value, json};
use std::fs;
use std::sync::Arc;

fn core() -> (tempfile::TempDir, Core) {
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
    (data, core)
}

fn call(core: &Core, cmd: &str, args: Value) -> Value {
    core.dispatch(cmd, args)
        .unwrap_or_else(|e| panic!("{cmd} failed: {e:?}"))
}

#[test]
fn list_project_dir_sorts_entries_hides_git_and_marks_ignored() {
    let repo = TempRepo::with_commit();
    repo.write(".gitignore", "target/\n*.log\n");
    repo.write("target/app.jar", "jar");
    repo.write("debug.log", "log");
    repo.write("src/main/App.java", "class App {}\n");
    repo.write("README.md", "# Title\n");

    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({ "path": repo.path() }));
    let path = info["path"].as_str().unwrap();

    let entries = call(
        &core,
        "list_project_dir",
        json!({ "path": path, "dir": "" }),
    );
    let list = entries.as_array().unwrap();
    assert!(!list.iter().any(|item| item["name"] == ".git"));

    let src = list.iter().find(|item| item["name"] == "src").unwrap();
    assert_eq!(src["isDir"], true);
    assert_eq!(src["ignored"], false);

    let target = list.iter().find(|item| item["name"] == "target").unwrap();
    assert_eq!(target["isDir"], true);
    assert_eq!(target["ignored"], true);

    let log = list
        .iter()
        .find(|item| item["name"] == "debug.log")
        .unwrap();
    assert_eq!(log["isDir"], false);
    assert_eq!(log["ignored"], true);

    let nested = call(
        &core,
        "list_project_dir",
        json!({ "path": path, "dir": "src/main" }),
    );
    let nested_list = nested.as_array().unwrap();
    assert_eq!(nested_list.len(), 1);
    assert_eq!(nested_list[0]["path"], "src/main/App.java");
}

#[test]
fn list_project_dir_rejects_traversal_and_missing_dirs() {
    let repo = TempRepo::with_commit();
    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({ "path": repo.path() }));
    let path = info["path"].as_str().unwrap();

    let err = core
        .dispatch("list_project_dir", json!({ "path": path, "dir": "../" }))
        .unwrap_err();
    assert_eq!(json!(err)["code"], "invalidArgs");

    let missing = core
        .dispatch("list_project_dir", json!({ "path": path, "dir": "nope" }))
        .unwrap_err();
    assert_eq!(json!(missing)["code"], "notFound");
}

#[test]
fn read_project_file_handles_text_crlf_binary_image_and_missing() {
    let repo = TempRepo::with_commit();
    repo.write("hello.txt", "line1\r\nline2\r\n");
    fs::write(repo.path().join("raw.bin"), [0u8, 255, 1, 2]).unwrap();
    fs::write(repo.path().join("logo.png"), [137u8, 80, 78, 71]).unwrap();

    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({ "path": repo.path() }));
    let path = info["path"].as_str().unwrap();

    let text = call(
        &core,
        "read_project_file",
        json!({ "path": path, "file": "hello.txt" }),
    );
    assert_eq!(text["content"], "text");
    assert_eq!(text["crlf"], true);
    assert_eq!(text["text"], "line1\nline2\n");
    assert_eq!(text["encoding"], "UTF-8");

    let bin = call(
        &core,
        "read_project_file",
        json!({ "path": path, "file": "raw.bin" }),
    );
    assert_eq!(bin["content"], "binary");
    assert_eq!(bin["text"], "");

    let img = call(
        &core,
        "read_project_file",
        json!({ "path": path, "file": "logo.png" }),
    );
    assert_eq!(img["content"], "image");

    let missing = core
        .dispatch(
            "read_project_file",
            json!({ "path": path, "file": "missing.txt" }),
        )
        .unwrap_err();
    assert_eq!(json!(missing)["code"], "notFound");
}

#[cfg(unix)]
#[test]
fn read_project_file_rejects_symlink_escaping_repo() {
    let repo = TempRepo::with_commit();
    let outside = tempfile::tempdir().unwrap();
    let secret = outside.path().join("secret.txt");
    fs::write(&secret, "top secret").unwrap();
    std::os::unix::fs::symlink(&secret, repo.path().join("escape.txt")).unwrap();

    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({ "path": repo.path() }));
    let path = info["path"].as_str().unwrap();

    let err = core
        .dispatch(
            "read_project_file",
            json!({ "path": path, "file": "escape.txt" }),
        )
        .unwrap_err();
    assert_eq!(json!(err)["code"], "invalidArgs");
}

#[test]
fn search_symbol_ranks_declarations_first_skips_origin_and_ignored() {
    let repo = TempRepo::with_commit();
    repo.write(".gitignore", "ignored.java\n");
    repo.write(
        "src/Service.java",
        "public class Service {\n    public String getLatestObservation(long id)\n    {\n        return \"ok\";\n    }\n}\n",
    );
    repo.write(
        "src/Controller.java",
        "class Controller {\n    void run() {\n        service.getLatestObservation(1);\n    }\n}\n",
    );
    repo.write("ignored.java", "service.getLatestObservation(2);\n");
    fs::write(repo.path().join("bin.dat"), b"\0getLatestObservation\0").unwrap();

    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({ "path": repo.path() }));
    let path = info["path"].as_str().unwrap();

    let from_call = call(
        &core,
        "search_symbol",
        json!({
            "path": path,
            "symbol": "getLatestObservation",
            "currentFile": "src/Controller.java",
            "currentLine": 3
        }),
    );
    let matches = from_call["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0]["file"], "src/Service.java");
    assert_eq!(matches[0]["line"], 2);
    assert_eq!(matches[0]["isDeclaration"], true);

    let all = call(
        &core,
        "search_symbol",
        json!({
            "path": path,
            "symbol": "getLatestObservation"
        }),
    );
    let all_matches = all["matches"].as_array().unwrap();
    assert_eq!(all_matches.len(), 2);
    assert_eq!(all_matches[0]["file"], "src/Service.java");
    assert_eq!(all_matches[1]["file"], "src/Controller.java");
}
