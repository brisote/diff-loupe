#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, NoEvents, RecordedEvents};
use diffloupe_core::platform;
use diffloupe_core::testutil::{TempRepo, git_in, isolate, test_env};
use serde_json::{Value, json};
use std::fs;
use std::sync::Arc;

fn core() -> (tempfile::TempDir, Core) {
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
    (data, core)
}

fn recording() -> (tempfile::TempDir, Core, Arc<RecordedEvents>) {
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    (data, core, events)
}

fn call(core: &Core, cmd: &str, args: Value) -> Value {
    core.dispatch(cmd, args)
        .unwrap_or_else(|e| panic!("{cmd} failed: {e:?}"))
}

#[test]
fn open_repo_returns_name_branch_and_the_default_branch_as_target() {
    let repo = TempRepo::with_commit();
    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({"path": repo.path()}));
    assert_eq!(info["name"], "acme-billing");
    assert_eq!(info["branch"], "main");
    assert_eq!(info["target"], "main");
    assert_eq!(info["defaultBranch"], "main");
    assert_eq!(info["lastTab"], "review");
    assert_eq!(
        info["path"],
        platform::canonicalize(repo.path())
            .unwrap()
            .display()
            .to_string()
    );
}

#[test]
fn open_repo_from_a_subfolder_finds_the_root() {
    let repo = TempRepo::with_commit();
    repo.write("billing/src/Main.kt", "fun main() {}\n");
    let (_data, core) = core();
    let info = call(
        &core,
        "open_repo",
        json!({"path": repo.path().join("billing/src")}),
    );
    assert_eq!(info["name"], "acme-billing");
}

#[test]
fn a_plain_folder_is_not_a_repository() {
    let plain = tempfile::tempdir().unwrap();
    let (_data, core) = core();
    let err = core
        .dispatch("open_repo", json!({"path": plain.path()}))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "notARepository");
    assert!(err.message.contains("is not a git repository"));
    let canonical = platform::canonicalize(plain.path())
        .unwrap()
        .display()
        .to_string();
    assert_eq!(err.path.as_deref(), Some(canonical.as_str()));
}

#[test]
fn a_missing_folder_is_reported() {
    let (_data, core) = core();
    let err = core
        .dispatch("open_repo", json!({"path": "/no/such/folder"}))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "notFound");
}

#[cfg(unix)]
#[test]
fn an_unreadable_folder_is_not_called_a_plain_folder() {
    let dir = tempfile::tempdir().unwrap();
    let locked = dir.path().join("locked");
    fs::create_dir(&locked).unwrap();
    let mut permissions = fs::metadata(&locked).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o000);
    fs::set_permissions(&locked, permissions.clone()).unwrap();
    let (_data, core) = core();
    let err = core
        .dispatch("open_repo", json!({"path": locked}))
        .unwrap_err();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
    fs::set_permissions(&locked, permissions).unwrap();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "io");
}

#[test]
fn a_bare_repository_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    git_in(dir.path(), &["init", "-q", "--bare", "x.git"]);
    let (_data, core) = core();
    let err = core
        .dispatch("open_repo", json!({"path": dir.path().join("x.git")}))
        .unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "bareRepository");
}

#[test]
fn opening_repositories_fills_the_recent_list_newest_first() {
    let a = TempRepo::with_commit();
    let b = TempRepo::with_commit();
    b.branch("gs/invoice-export");
    let (_data, core) = core();
    call(&core, "open_repo", json!({"path": a.path()}));
    std::thread::sleep(std::time::Duration::from_millis(5));
    call(&core, "open_repo", json!({"path": b.path()}));
    let recent = call(&core, "recent_repos", Value::Null);
    let recent = recent.as_array().unwrap();
    assert_eq!(recent.len(), 2);
    assert_eq!(recent[0]["branch"], "gs/invoice-export");
    assert_eq!(recent[0]["exists"], true);
    let after = call(&core, "remove_recent", json!({"path": recent[1]["path"]}));
    assert_eq!(after.as_array().unwrap().len(), 1);
}

#[test]
fn the_open_repository_switches_in_place_and_remembers_its_tab() {
    let a = TempRepo::with_commit();
    let b = TempRepo::with_commit();
    let (_data, core) = core();
    let first = call(&core, "open_repo", json!({"path": a.path()}));
    let second = call(&core, "open_repo", json!({"path": b.path()}));
    call(
        &core,
        "set_repo_view",
        json!({"path": first["path"], "tab": "log", "selection": "abc123"}),
    );
    assert_eq!(second["lastTab"], "review");
    assert_eq!(
        call(&core, "current_repo", Value::Null)["lastTab"],
        "review"
    );
    let back = call(&core, "open_repo", json!({"path": a.path()}));
    assert_eq!(back["lastTab"], "log");
    assert_eq!(back["lastSelection"], "abc123");
    call(&core, "close_repo", Value::Null);
    assert_eq!(call(&core, "current_repo", Value::Null), Value::Null);
}

#[test]
fn target_prefers_the_remote_default_branch() {
    let repo = TempRepo::with_commit();
    repo.bare_remote();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["remote", "set-head", "origin", "main"]);
    repo.branch("develop");
    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({"path": repo.path()}));
    assert_eq!(info["branch"], "develop");
    assert_eq!(info["target"], "main");
}

#[test]
fn opening_reports_a_task_that_finishes() {
    let repo = TempRepo::with_commit();
    let (_data, core, events) = recording();
    core.dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    let events: Vec<_> = events
        .take()
        .into_iter()
        .filter(|event| matches!(event, CoreEvent::Task { .. }))
        .collect();
    assert!(
        matches!(&events[0], CoreEvent::Task { done: false, label, .. } if label == "Opening acme-billing")
    );
    assert!(matches!(
        events.last(),
        Some(CoreEvent::Task { done: true, .. })
    ));
}

#[test]
fn settings_survive_a_restart() {
    let data = tempfile::tempdir().unwrap();
    {
        let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
        let mut settings = call(&core, "get_settings", Value::Null);
        settings["diff"]["viewer"] = json!("unified");
        call(&core, "set_settings", json!({"settings": settings}));
    }
    let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
    assert_eq!(
        call(&core, "get_settings", Value::Null)["diff"]["viewer"],
        "unified"
    );
    assert!(fs::metadata(data.path().join("settings.json")).is_ok());
}

#[test]
fn ui_values_round_trip_and_unknown_commands_fail() {
    let (_data, core) = core();
    call(
        &core,
        "set_ui_value",
        json!({"key": "toolWidth", "value": "380"}),
    );
    assert_eq!(
        call(&core, "get_ui_value", json!({"key": "toolWidth"})),
        "380"
    );
    let err = core.dispatch("nope", Value::Null).unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "unknownCommand");
    let err = core.dispatch("open_repo", json!({"wrong": 1})).unwrap_err();
    assert_eq!(serde_json::to_value(err.code).unwrap(), "invalidArgs");
}

#[cfg(windows)]
fn expected_home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap()
}

#[cfg(not(windows))]
fn expected_home() -> String {
    std::env::var("HOME").unwrap()
}

#[test]
fn app_info_reports_a_broken_settings_file() {
    let data = tempfile::tempdir().unwrap();
    fs::write(data.path().join("settings.json"), "[1,").unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
    let info = call(&core, "app_info", Value::Null);
    assert!(
        info["settingsNotice"]
            .as_str()
            .unwrap()
            .contains("could not be read")
    );
    assert_eq!(info["home"], expected_home());
}

#[test]
fn open_repo_handles_spaces_in_the_folder_name() {
    let dir = tempfile::tempdir().unwrap();
    let spaced = dir.path().join("My Projects").join("Acme Billing");
    fs::create_dir_all(&spaced).unwrap();
    git_in(&spaced, &["init", "-q", "-b", "main"]);
    isolate(&spaced);
    fs::write(spaced.join("README.md"), "# Acme Billing\n").unwrap();
    git_in(&spaced, &["add", "-A"]);
    git_in(&spaced, &["commit", "-q", "-m", "Initial commit"]);

    let (_data, core) = core();
    let info = call(&core, "open_repo", json!({"path": spaced}));
    assert_eq!(info["name"], "Acme Billing");
    assert_eq!(info["branch"], "main");
    let canonical = platform::canonicalize(&spaced)
        .unwrap()
        .display()
        .to_string();
    assert!(!canonical.starts_with(r"\\?\"));
    assert_eq!(info["path"], canonical);
    let recent = call(&core, "recent_repos", Value::Null);
    assert_eq!(recent.as_array().unwrap().len(), 1);
    assert_eq!(recent[0]["path"], canonical);
}
