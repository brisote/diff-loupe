#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::NoEvents;
use diffloupe_core::settings::{Settings, Viewer, Whitespace};
use diffloupe_core::store::{
    APP_VERSION, BACKUPS_DIR, RepoState, SETTINGS_FILE, STATE_FILE, Store,
};
use diffloupe_core::testutil::test_env;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const REPO: &str = "/Users/ada/work/acme-billing";
const OTHER: &str = "/Users/ada/work/ledger";
const UI: &[(&str, &str)] = &[
    ("toolWindowWidth", "340"),
    ("terminalHeight", "260"),
    ("changes.showUnversioned", "false"),
];

fn sample_settings() -> Settings {
    let mut settings = Settings::default();
    settings.diff.viewer = Viewer::Unified;
    settings.diff.whitespace = Whitespace::Trim;
    settings.diff.collapse_unchanged = false;
    settings.updates.check = false;
    settings
}

fn sample_repo_state() -> RepoState {
    RepoState {
        target_branch: Some("develop".into()),
        last_tab: Some("log".into()),
        last_selection: Some("src/billing.rs".into()),
    }
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/stores")
}

#[test]
fn write_the_store_fixture_of_this_release() {
    let Some(target) = std::env::var_os("DIFFLOUPE_STORE_FIXTURE").map(PathBuf::from) else {
        return;
    };
    assert!(!target.exists(), "the fixture of a release never changes");
    let data = tempfile::tempdir().unwrap();
    let mut store = Store::open(data.path()).unwrap();
    store.save_settings(sample_settings()).unwrap();
    store
        .touch_recent(
            REPO,
            "acme-billing",
            Some("feature/invoices"),
            1_790_000_000_000,
        )
        .unwrap();
    store
        .touch_recent(OTHER, "ledger", Some("main"), 1_780_000_000_000)
        .unwrap();
    store.set_repo_state(REPO, &sample_repo_state()).unwrap();
    for (key, value) in UI {
        store.set_ui_value(key, value).unwrap();
    }
    store
        .add_commit_message(REPO, "Add invoice totals", 1)
        .unwrap();
    store.add_commit_message(REPO, "Fix rounding", 2).unwrap();
    drop(store);
    fs::create_dir_all(&target).unwrap();
    for file in [STATE_FILE, SETTINGS_FILE] {
        fs::copy(data.path().join(file), target.join(file)).unwrap();
    }
}

#[test]
fn this_release_has_a_store_fixture() {
    assert!(
        fixtures().join(APP_VERSION).join(STATE_FILE).exists(),
        "add the store fixture of {APP_VERSION}: DIFFLOUPE_STORE_FIXTURE=tests/fixtures/stores/{APP_VERSION} cargo test -p diffloupe-core --test release_upgrade write_the_store_fixture"
    );
}

#[test]
fn every_manifest_names_this_release_and_the_changelog_lists_it() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for file in ["package.json", "backend/app/tauri.conf.json"] {
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(root.join(file)).unwrap()).unwrap();
        assert_eq!(manifest["version"], APP_VERSION, "{file}");
    }
    let changelog = fs::read_to_string(root.join("CHANGELOG.md")).unwrap();
    assert!(
        changelog.contains(&format!("\n## {APP_VERSION}\n")),
        "CHANGELOG.md has no section for {APP_VERSION}"
    );
}

#[test]
fn stores_of_every_release_upgrade_and_keep_their_data() {
    let mut releases: Vec<PathBuf> = fs::read_dir(fixtures())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    releases.sort();
    for release in releases {
        let name = release.file_name().unwrap().to_string_lossy().into_owned();
        let data = tempfile::tempdir().unwrap();
        for file in [STATE_FILE, SETTINGS_FILE] {
            fs::copy(release.join(file), data.path().join(file)).unwrap();
        }
        let fixture_schema: i64 = rusqlite::Connection::open(data.path().join(STATE_FILE))
            .unwrap()
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        let store =
            Store::open(data.path()).unwrap_or_else(|e| panic!("{name} does not open: {e}"));
        let stored_updates = serde_json::from_str::<serde_json::Value>(
            &fs::read_to_string(release.join(SETTINGS_FILE)).unwrap(),
        )
        .unwrap()
        .get("updates")
        .is_some();
        let mut expected = sample_settings();
        if !stored_updates {
            expected.updates = Default::default();
        }
        assert_eq!(store.settings(), &expected, "{name}");
        assert_eq!(store.written_by().as_deref(), Some(APP_VERSION), "{name}");
        let recent: Vec<_> = store
            .recent()
            .unwrap()
            .into_iter()
            .map(|r| (r.path, r.branch))
            .collect();
        assert_eq!(
            recent,
            [
                (REPO.to_string(), Some("feature/invoices".to_string())),
                (OTHER.to_string(), Some("main".to_string())),
            ],
            "{name}"
        );
        assert_eq!(
            store.repo_state(REPO).unwrap(),
            sample_repo_state(),
            "{name}"
        );
        for (key, value) in UI {
            assert_eq!(
                store.ui_value(key).unwrap().as_deref(),
                Some(*value),
                "{name} {key}"
            );
        }
        assert_eq!(
            store.commit_messages(REPO).unwrap(),
            ["Fix rounding", "Add invoice totals"],
            "{name}"
        );
        let settings_version = |dir: &Path| {
            serde_json::from_str::<serde_json::Value>(
                &fs::read_to_string(dir.join(SETTINGS_FILE)).unwrap(),
            )
            .unwrap()["version"]
                .as_u64()
                .unwrap_or(0)
        };
        let migrated = fixture_schema < store.schema_version().unwrap()
            || settings_version(&release) != settings_version(data.path());
        drop(store);
        assert_eq!(
            data.path().join(BACKUPS_DIR).exists(),
            migrated,
            "{name} keeps a backup only when it was migrated"
        );
        let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
        let settings = core.dispatch("get_settings", json!({})).unwrap();
        assert_eq!(settings["diff"]["viewer"], "unified", "{name}");
        assert_eq!(
            settings["updates"]["check"], !stored_updates,
            "{name} keeps the update check or gets its default"
        );
        let recent = core.dispatch("recent_repos", json!({})).unwrap();
        assert_eq!(recent.as_array().map(Vec::len), Some(2), "{name}");
        let mut changed = settings.clone();
        changed["diff"]["syncScroll"] = json!(false);
        core.dispatch("set_settings", json!({ "settings": changed }))
            .unwrap();
        assert_eq!(
            raw_settings(data.path()).get("agent"),
            raw_settings(&release).get("agent"),
            "{name} keeps the settings that this version no longer reads"
        );
    }
}

fn raw_settings(dir: &Path) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(dir.join(SETTINGS_FILE)).unwrap()).unwrap()
}
