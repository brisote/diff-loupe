use crate::error::{Error, Result};
use crate::settings::{Settings, merge_into};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const SETTINGS_FILE: &str = "settings.json";
pub const STATE_FILE: &str = "state.db";
pub const BROKEN_SETTINGS_FILE: &str = "settings.broken.json";
pub const BACKUPS_DIR: &str = "backups";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const KEPT_BACKUPS: usize = 3;
const MESSAGE_HISTORY: usize = 20;

const MIGRATIONS: &[&str] = &[
    "CREATE TABLE recent (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        branch TEXT,
        last_opened INTEGER NOT NULL
    );
    CREATE TABLE repo_state (
        path TEXT PRIMARY KEY,
        target_branch TEXT,
        last_tab TEXT,
        last_selection TEXT
    );
    CREATE TABLE ui_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
    "CREATE TABLE commit_message (
        repo TEXT NOT NULL,
        message TEXT NOT NULL,
        used_at INTEGER NOT NULL,
        PRIMARY KEY (repo, message)
    );",
    "CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
];

pub type SettingsMigration = fn(&mut Value) -> std::result::Result<(), String>;

const SETTINGS_MIGRATIONS: &[SettingsMigration] = &[];

pub struct Migrations<'a> {
    pub state: &'a [&'a str],
    pub settings: &'a [SettingsMigration],
}

pub const CURRENT: Migrations<'static> = Migrations {
    state: MIGRATIONS,
    settings: SETTINGS_MIGRATIONS,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentRow {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub last_opened: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RepoState {
    pub target_branch: Option<String>,
    pub last_tab: Option<String>,
    pub last_selection: Option<String>,
}

pub struct Store {
    dir: PathBuf,
    raw: Value,
    settings: Settings,
    settings_version: usize,
    notice: Option<String>,
    db: Connection,
}

impl Store {
    pub fn open(dir: &Path) -> Result<Store> {
        Store::open_with(dir, &CURRENT)
    }

    pub fn open_with(dir: &Path, migrations: &Migrations) -> Result<Store> {
        fs::create_dir_all(dir)?;
        let path = dir.join(SETTINGS_FILE);
        let (mut raw, unreadable) = read_settings(&path);
        let db = Connection::open(dir.join(STATE_FILE))?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        let state_from = user_version(&db)?;
        let settings_from = settings_version(&raw);
        if state_from > migrations.state.len() || settings_from > migrations.settings.len() {
            return Err(Error::NewerStore(newer_store_message(written_by(&db))));
        }
        let settings_due =
            raw.is_object() && path.exists() && settings_from < migrations.settings.len();
        let state_due = state_from < migrations.state.len();
        let backup = if settings_due || (state_due && state_from > 0) {
            Some(back_up(dir, &db, written_by(&db))?)
        } else {
            None
        };
        if let Err(reason) = upgrade(&db, &mut raw, &path, migrations, state_from, settings_due) {
            drop(db);
            let restored = backup.as_deref().map(|backup| restore(dir, backup));
            return Err(Error::Upgrade(upgrade_message(
                &reason,
                backup.as_deref(),
                restored.and_then(|r| r.err()),
            )));
        }
        record_version(&db)?;
        let (settings, notice) = parse_settings(&path, &raw, unreadable);
        Ok(Store {
            dir: dir.to_path_buf(),
            raw,
            settings,
            settings_version: migrations.settings.len(),
            notice,
            db,
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    pub fn notice(&self) -> Option<&str> {
        self.notice.as_deref()
    }

    pub fn save_settings(&mut self, settings: Settings) -> Result<()> {
        let mut raw = if self.raw.is_object() {
            self.raw.clone()
        } else {
            Value::Object(Default::default())
        };
        merge_into(&mut raw, serde_json::to_value(&settings)?);
        raw["version"] = Value::from(self.settings_version);
        let text = serde_json::to_string_pretty(&raw)?;
        let path = self.dir.join(SETTINGS_FILE);
        if self.raw.is_null() && path.exists() {
            fs::copy(&path, self.dir.join(BROKEN_SETTINGS_FILE))?;
        }
        write_atomic(&path, &text)?;
        self.raw = raw;
        self.settings = settings;
        self.notice = None;
        Ok(())
    }

    pub fn touch_recent(
        &self,
        path: &str,
        name: &str,
        branch: Option<&str>,
        now: i64,
    ) -> Result<()> {
        self.db.execute(
            "INSERT INTO recent (path, name, branch, last_opened) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET name = ?2, branch = ?3, last_opened = ?4",
            params![path, name, branch, now],
        )?;
        Ok(())
    }

    pub fn recent(&self) -> Result<Vec<RecentRow>> {
        let mut stmt = self.db.prepare(
            "SELECT path, name, branch, last_opened FROM recent ORDER BY last_opened DESC, path",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(RecentRow {
                path: r.get(0)?,
                name: r.get(1)?,
                branch: r.get(2)?,
                last_opened: r.get(3)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    pub fn remove_recent(&self, path: &str) -> Result<()> {
        self.db
            .execute("DELETE FROM recent WHERE path = ?1", params![path])?;
        Ok(())
    }

    pub fn repo_state(&self, path: &str) -> Result<RepoState> {
        let row = self
            .db
            .query_row(
                "SELECT target_branch, last_tab, last_selection FROM repo_state WHERE path = ?1",
                params![path],
                |r| {
                    Ok(RepoState {
                        target_branch: r.get(0)?,
                        last_tab: r.get(1)?,
                        last_selection: r.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(row.unwrap_or_default())
    }

    pub fn set_repo_state(&self, path: &str, state: &RepoState) -> Result<()> {
        self.db.execute(
            "INSERT INTO repo_state (path, target_branch, last_tab, last_selection) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET target_branch = ?2, last_tab = ?3, last_selection = ?4",
            params![path, state.target_branch, state.last_tab, state.last_selection],
        )?;
        Ok(())
    }

    pub fn ui_value(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .db
            .query_row(
                "SELECT value FROM ui_state WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn set_ui_value(&self, key: &str, value: &str) -> Result<()> {
        self.db.execute(
            "INSERT INTO ui_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn add_commit_message(&self, repo: &str, message: &str, now: i64) -> Result<()> {
        self.db.execute(
            "INSERT INTO commit_message (repo, message, used_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(repo, message) DO UPDATE SET used_at = ?3",
            params![repo, message, now],
        )?;
        self.db.execute(
            "DELETE FROM commit_message WHERE repo = ?1 AND message NOT IN
             (SELECT message FROM commit_message WHERE repo = ?1 ORDER BY used_at DESC LIMIT ?2)",
            params![repo, MESSAGE_HISTORY as i64],
        )?;
        Ok(())
    }

    pub fn commit_messages(&self, repo: &str) -> Result<Vec<String>> {
        let mut stmt = self.db.prepare(
            "SELECT message FROM commit_message WHERE repo = ?1 ORDER BY used_at DESC, message",
        )?;
        let rows = stmt.query_map(params![repo], |r| r.get(0))?;
        rows.collect::<std::result::Result<Vec<String>, _>>()
            .map_err(Error::from)
    }

    pub fn schema_version(&self) -> Result<i64> {
        Ok(self
            .db
            .pragma_query_value(None, "user_version", |r| r.get(0))?)
    }

    pub fn written_by(&self) -> Option<String> {
        written_by(&self.db)
    }
}

fn read_settings(path: &Path) -> (Value, Option<String>) {
    let Ok(text) = fs::read_to_string(path) else {
        return (Value::Object(Default::default()), None);
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(raw) => (raw, None),
        Err(e) => (Value::Null, Some(e.to_string())),
    }
}

fn parse_settings(
    path: &Path,
    raw: &Value,
    unreadable: Option<String>,
) -> (Settings, Option<String>) {
    if let Some(reason) = unreadable {
        return (Settings::default(), Some(broken_notice(path, &reason)));
    }
    let (settings, rejected) = Settings::from_raw(raw);
    let notice = (!rejected.is_empty()).then(|| {
        let reason = format!("invalid value for {}", rejected.join(", "));
        broken_notice(path, &reason)
    });
    (settings, notice)
}

fn settings_version(raw: &Value) -> usize {
    raw.get("version").and_then(Value::as_u64).unwrap_or(0) as usize
}

fn user_version(db: &Connection) -> Result<usize> {
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    Ok(version.max(0) as usize)
}

fn written_by(db: &Connection) -> Option<String> {
    db.query_row(
        "SELECT value FROM meta WHERE key = 'app_version'",
        [],
        |r| r.get(0),
    )
    .ok()
}

fn record_version(db: &Connection) -> Result<()> {
    let has_meta = db
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !has_meta {
        return Ok(());
    }
    db.execute(
        "INSERT INTO meta (key, value) VALUES ('app_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1 WHERE value <> ?1",
        params![APP_VERSION],
    )?;
    Ok(())
}

fn upgrade(
    db: &Connection,
    raw: &mut Value,
    path: &Path,
    migrations: &Migrations,
    state_from: usize,
    settings_due: bool,
) -> std::result::Result<(), String> {
    if settings_due {
        for step in &migrations.settings[settings_version(raw)..] {
            step(raw)?;
        }
        raw["version"] = Value::from(migrations.settings.len());
    }
    migrate(db, migrations.state, state_from).map_err(|e| e.to_string())?;
    if settings_due {
        let text = serde_json::to_string_pretty(raw).map_err(|e| e.to_string())?;
        write_atomic(path, &text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn migrate(db: &Connection, steps: &[&str], from: usize) -> Result<()> {
    if from >= steps.len() {
        return Ok(());
    }
    let tx = db.unchecked_transaction()?;
    for sql in &steps[from..] {
        tx.execute_batch(sql)?;
    }
    tx.pragma_update(None, "user_version", steps.len() as i64)?;
    tx.commit()?;
    Ok(())
}

fn write_atomic(path: &Path, text: &str) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, format!("{text}\n"))?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn back_up(dir: &Path, db: &Connection, from: Option<String>) -> Result<PathBuf> {
    let root = dir.join(BACKUPS_DIR);
    fs::create_dir_all(&root)?;
    let stamp = gix::date::Time::now_local_or_utc()
        .format(gix::date::time::CustomFormat::new("%Y-%m-%d-%H%M%S"))
        .map_err(|e| Error::Store(format!("could not name the backup: {e}")))?;
    let name = format!("{stamp}-from-{}", from.as_deref().unwrap_or("earlier"));
    let mut target = root.join(&name);
    for n in 2.. {
        if !target.exists() {
            break;
        }
        target = root.join(format!("{name}-{n}"));
    }
    fs::create_dir(&target)?;
    db.execute(
        "VACUUM INTO ?1",
        params![target.join(STATE_FILE).to_string_lossy()],
    )?;
    let settings = dir.join(SETTINGS_FILE);
    if settings.exists() {
        fs::copy(&settings, target.join(SETTINGS_FILE))?;
    }
    prune_backups(&root, &target)?;
    Ok(target)
}

fn prune_backups(root: &Path, newest: &Path) -> Result<()> {
    let mut names: Vec<PathBuf> = fs::read_dir(root)?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.is_dir() && path != newest)
        .collect();
    names.sort();
    let extra = names.len().saturating_sub(KEPT_BACKUPS - 1);
    for old in &names[..extra] {
        fs::remove_dir_all(old)?;
    }
    Ok(())
}

fn restore(dir: &Path, backup: &Path) -> Result<()> {
    for suffix in ["-wal", "-shm"] {
        let side = dir.join(format!("{STATE_FILE}{suffix}"));
        if side.exists() {
            fs::remove_file(side)?;
        }
    }
    copy_atomic(&backup.join(STATE_FILE), &dir.join(STATE_FILE))?;
    let settings = backup.join(SETTINGS_FILE);
    if settings.exists() {
        copy_atomic(&settings, &dir.join(SETTINGS_FILE))?;
    }
    Ok(())
}

fn copy_atomic(from: &Path, to: &Path) -> Result<()> {
    let mut tmp = to.as_os_str().to_owned();
    tmp.push(".restore");
    let tmp = PathBuf::from(tmp);
    fs::copy(from, &tmp)?;
    fs::rename(&tmp, to)?;
    Ok(())
}

fn newer_store_message(by: Option<String>) -> String {
    match by {
        Some(version) => format!(
            "Your Diffloupe data was saved by Diffloupe {version}, which is newer than this version ({APP_VERSION}). To keep the data safe, this version does not open it. Install Diffloupe {version} or later."
        ),
        None => format!(
            "Your Diffloupe data was saved by a newer version than this one ({APP_VERSION}). To keep the data safe, this version does not open it. Install the newer version again."
        ),
    }
}

fn upgrade_message(reason: &str, backup: Option<&Path>, restore_failed: Option<Error>) -> String {
    match (backup, restore_failed) {
        (Some(backup), None) => format!(
            "Diffloupe could not update its saved data: {reason}. Your data is back as it was before the update, and a copy is in {}.",
            backup.display()
        ),
        (Some(backup), Some(failure)) => format!(
            "Diffloupe could not update its saved data: {reason}. It could not put the data back either ({failure}). A copy of the data from before the update is in {}.",
            backup.display()
        ),
        (None, _) => format!("Diffloupe could not set up its saved data: {reason}."),
    }
}

fn broken_notice(path: &Path, reason: &str) -> String {
    format!(
        "{} could not be read ({reason}). Diffloupe uses the defaults for what it cannot read and leaves the file as it is until you save the settings.",
        path.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{Viewer, Whitespace};
    use serde_json::json;

    #[test]
    fn settings_round_trip_keeps_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"later": {"x": 1}, "diff": {"viewer": "sideBySide", "extra": "keep"}}"#,
        )
        .unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let mut s = store.settings().clone();
        s.diff.viewer = Viewer::Unified;
        store.save_settings(s).unwrap();
        let saved: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join(SETTINGS_FILE)).unwrap())
                .unwrap();
        assert_eq!(saved["later"], json!({"x": 1}));
        assert_eq!(saved["diff"]["extra"], json!("keep"));
        assert_eq!(saved["diff"]["viewer"], json!("unified"));
        let reopened = Store::open(dir.path()).unwrap();
        assert_eq!(reopened.settings().diff.viewer, Viewer::Unified);
    }

    #[test]
    fn broken_settings_fall_back_and_stay_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        fs::write(&path, "{ not json").unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.settings(), &Settings::default());
        assert!(store.notice().unwrap().contains("could not be read"));
        drop(store);
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn one_bad_value_keeps_the_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"diff": {"viewer": "sideways", "whitespace": "trim"}}"#,
        )
        .unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        assert_eq!(store.settings().diff.viewer, Viewer::SideBySide);
        assert_eq!(store.settings().diff.whitespace, Whitespace::Trim);
        assert!(store.notice().unwrap().contains("diff.viewer"));
        store.save_settings(store.settings().clone()).unwrap();
        let reopened = Store::open(dir.path()).unwrap();
        assert_eq!(reopened.settings().diff.whitespace, Whitespace::Trim);
        assert_eq!(reopened.notice(), None);
    }

    #[test]
    fn saving_over_an_unreadable_file_keeps_a_copy() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SETTINGS_FILE), "{ not json").unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        store.save_settings(Settings::default()).unwrap();
        let copy = fs::read_to_string(dir.path().join(BROKEN_SETTINGS_FILE)).unwrap();
        assert_eq!(copy, "{ not json");
        assert!(Store::open(dir.path()).unwrap().notice().is_none());
    }

    #[test]
    fn commit_messages_keep_the_newest_twenty_per_repository() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        for n in 0..25 {
            store.add_commit_message("/a", &format!("m{n}"), n).unwrap();
        }
        store.add_commit_message("/a", "m3", 100).unwrap();
        store.add_commit_message("/b", "other", 1).unwrap();
        let messages = store.commit_messages("/a").unwrap();
        assert_eq!(messages.len(), 20);
        assert_eq!(messages[0], "m3");
        assert_eq!(messages[1], "m24");
        assert_eq!(store.commit_messages("/b").unwrap(), ["other"]);
    }

    #[test]
    fn migrations_run_once_on_empty_and_existing_databases() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as i64);
        store.touch_recent("/a", "a", Some("main"), 1).unwrap();
        drop(store);
        let again = Store::open(dir.path()).unwrap();
        assert_eq!(again.schema_version().unwrap(), MIGRATIONS.len() as i64);
        assert_eq!(again.recent().unwrap().len(), 1);
    }

    #[test]
    fn recent_list_is_newest_first_and_updates_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        store.touch_recent("/a", "a", None, 1).unwrap();
        store.touch_recent("/b", "b", None, 2).unwrap();
        store.touch_recent("/a", "a", Some("dev"), 3).unwrap();
        let names: Vec<_> = store
            .recent()
            .unwrap()
            .into_iter()
            .map(|r| r.name)
            .collect();
        assert_eq!(names, ["a", "b"]);
        assert_eq!(store.recent().unwrap()[0].branch.as_deref(), Some("dev"));
        store.remove_recent("/a").unwrap();
        assert_eq!(store.recent().unwrap().len(), 1);
    }

    const OLD: Migrations<'static> = Migrations {
        state: &[MIGRATIONS[0], MIGRATIONS[1]],
        settings: &[],
    };

    fn rename_layout(raw: &mut Value) -> std::result::Result<(), String> {
        let old = raw["diff"]
            .as_object_mut()
            .and_then(|diff| diff.remove("layout"));
        if let Some(old) = old {
            raw["diff"]["viewer"] = old;
        }
        Ok(())
    }

    fn refuse(_: &mut Value) -> std::result::Result<(), String> {
        Err("the diff section has an unknown shape".into())
    }

    fn backups(dir: &Path) -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = fs::read_dir(dir.join(BACKUPS_DIR))
            .map(|entries| entries.filter_map(|e| e.ok().map(|e| e.path())).collect())
            .unwrap_or_default();
        found.sort();
        found
    }

    #[test]
    fn an_upgrade_backs_up_then_migrates_and_records_the_version() {
        let dir = tempfile::tempdir().unwrap();
        let old = Store::open_with(dir.path(), &OLD).unwrap();
        old.touch_recent("/a", "a", Some("main"), 1).unwrap();
        drop(old);
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as i64);
        assert_eq!(store.written_by().as_deref(), Some(APP_VERSION));
        assert_eq!(store.recent().unwrap().len(), 1);
        let found = backups(dir.path());
        assert_eq!(found.len(), 1);
        assert!(found[0].to_string_lossy().ends_with("-from-earlier"));
        let copy = Connection::open(found[0].join(STATE_FILE)).unwrap();
        assert_eq!(user_version(&copy).unwrap(), 2);
        drop(store);
        Store::open(dir.path()).unwrap();
        assert_eq!(backups(dir.path()).len(), 1);
    }

    #[test]
    fn a_new_store_needs_no_backup() {
        let dir = tempfile::tempdir().unwrap();
        Store::open(dir.path()).unwrap();
        assert!(backups(dir.path()).is_empty());
    }

    #[test]
    fn a_failed_migration_restores_the_backup() {
        let dir = tempfile::tempdir().unwrap();
        let old = Store::open_with(dir.path(), &OLD).unwrap();
        old.touch_recent("/a", "a", None, 1).unwrap();
        drop(old);
        let broken = Migrations {
            state: &[
                MIGRATIONS[0],
                MIGRATIONS[1],
                "CREATE TABLE extra (x);",
                "CREATE TABLE (",
            ],
            settings: &[],
        };
        let Err(Error::Upgrade(message)) = Store::open_with(dir.path(), &broken) else {
            panic!("the upgrade should fail");
        };
        assert!(message.contains("back as it was"), "{message}");
        assert!(message.contains(BACKUPS_DIR), "{message}");
        let store = Store::open_with(dir.path(), &OLD).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
        assert_eq!(store.recent().unwrap().len(), 1);
        assert!(store.db.prepare("SELECT * FROM extra").is_err());
    }

    #[test]
    fn a_failure_after_the_state_commit_puts_the_backup_back() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"diff": {"layout": "unified"}}"#,
        )
        .unwrap();
        let old = Store::open_with(dir.path(), &OLD).unwrap();
        old.touch_recent("/a", "a", None, 1).unwrap();
        drop(old);
        fs::create_dir(dir.path().join("settings.json.tmp")).unwrap();
        let renaming = Migrations {
            state: MIGRATIONS,
            settings: &[rename_layout],
        };
        let Err(Error::Upgrade(message)) = Store::open_with(dir.path(), &renaming) else {
            panic!("writing the settings should fail");
        };
        assert!(message.contains("back as it was"), "{message}");
        let store = Store::open_with(dir.path(), &OLD).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
        assert_eq!(store.recent().unwrap().len(), 1);
        assert!(store.db.prepare("SELECT * FROM meta").is_err());
    }

    #[test]
    fn a_failed_settings_migration_changes_neither_file() {
        let dir = tempfile::tempdir().unwrap();
        let text = r#"{"diff": {"layout": "unified"}}"#;
        fs::write(dir.path().join(SETTINGS_FILE), text).unwrap();
        drop(Store::open_with(dir.path(), &OLD).unwrap());
        let failing = Migrations {
            state: MIGRATIONS,
            settings: &[refuse],
        };
        let Err(Error::Upgrade(message)) = Store::open_with(dir.path(), &failing) else {
            panic!("the upgrade should fail");
        };
        assert!(message.contains("unknown shape"), "{message}");
        assert_eq!(
            fs::read_to_string(dir.path().join(SETTINGS_FILE)).unwrap(),
            text
        );
        let store = Store::open_with(dir.path(), &OLD).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
    }

    #[test]
    fn settings_migrations_run_from_the_version_in_the_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"later": 1, "diff": {"layout": "unified"}}"#,
        )
        .unwrap();
        let renaming = Migrations {
            state: MIGRATIONS,
            settings: &[rename_layout],
        };
        let store = Store::open_with(dir.path(), &renaming).unwrap();
        assert_eq!(store.settings().diff.viewer, Viewer::Unified);
        let saved: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join(SETTINGS_FILE)).unwrap())
                .unwrap();
        assert_eq!(
            saved,
            json!({"later": 1, "version": 1, "diff": {"viewer": "unified"}})
        );
        assert_eq!(backups(dir.path()).len(), 1);
        drop(store);
        Store::open_with(dir.path(), &renaming).unwrap();
        assert_eq!(backups(dir.path()).len(), 1);
    }

    #[test]
    fn data_from_a_newer_version_is_left_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        drop(Store::open(dir.path()).unwrap());
        let Err(Error::NewerStore(message)) = Store::open_with(dir.path(), &OLD) else {
            panic!("an older version must refuse newer data");
        };
        assert!(
            message.contains(&format!("Diffloupe {APP_VERSION}")),
            "{message}"
        );
        assert_eq!(
            Store::open(dir.path()).unwrap().schema_version().unwrap(),
            MIGRATIONS.len() as i64
        );
        let settings = r#"{"version": 9}"#;
        fs::write(dir.path().join(SETTINGS_FILE), settings).unwrap();
        assert!(matches!(Store::open(dir.path()), Err(Error::NewerStore(_))));
        assert_eq!(
            fs::read_to_string(dir.path().join(SETTINGS_FILE)).unwrap(),
            settings
        );
        assert!(backups(dir.path()).is_empty());
    }

    #[test]
    fn saved_settings_carry_the_settings_version() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        store.save_settings(Settings::default()).unwrap();
        let saved: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join(SETTINGS_FILE)).unwrap())
                .unwrap();
        assert_eq!(saved["version"], json!(SETTINGS_MIGRATIONS.len()));
    }

    #[test]
    fn only_the_newest_backups_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join(BACKUPS_DIR);
        for name in [
            "2026-01-01-000000",
            "2026-02-01-000000",
            "2026-03-01-000000",
            "2026-04-01-000000",
        ] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        let newest = root.join("2026-01-15-000000");
        fs::create_dir_all(&newest).unwrap();
        prune_backups(&root, &newest).unwrap();
        let names: Vec<String> = backups(dir.path())
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            [
                "2026-01-15-000000",
                "2026-03-01-000000",
                "2026-04-01-000000"
            ]
        );
    }

    #[test]
    fn repo_and_ui_state_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.repo_state("/a").unwrap(), RepoState::default());
        let state = RepoState {
            target_branch: Some("develop".into()),
            last_tab: Some("log".into()),
            last_selection: Some("src/a.rs".into()),
        };
        store.set_repo_state("/a", &state).unwrap();
        assert_eq!(store.repo_state("/a").unwrap(), state);
        store.set_ui_value("split", "320").unwrap();
        assert_eq!(store.ui_value("split").unwrap().as_deref(), Some("320"));
    }
}
