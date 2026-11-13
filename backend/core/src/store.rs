use crate::error::{Error, Result};
use crate::settings::{Settings, merge_into};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use ts_rs::TS;

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
    "CREATE TABLE ai_consent (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        accepted_at INTEGER NOT NULL
    );
    CREATE TABLE ai_review (
        repo TEXT NOT NULL COLLATE NOCASE,
        branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        report_markdown TEXT NOT NULL,
        cost_usd TEXT,
        head_oid TEXT,
        base_oid TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (repo, branch, target_branch)
    );
    CREATE TABLE ai_chat_message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL COLLATE NOCASE,
        branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        quoted_text TEXT,
        cost_usd TEXT,
        created_at INTEGER NOT NULL
    );",
    "CREATE TABLE ai_review_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL COLLATE NOCASE,
        branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        report_markdown TEXT NOT NULL,
        cost_usd TEXT,
        head_oid TEXT,
        base_oid TEXT,
        model TEXT,
        effort TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    INSERT INTO ai_review_new (repo, branch, target_branch, report_markdown, cost_usd, head_oid, base_oid, created_at, updated_at)
        SELECT repo, branch, target_branch, report_markdown, cost_usd, head_oid, base_oid, updated_at, updated_at
        FROM ai_review;
    DROP TABLE ai_review;
    ALTER TABLE ai_review_new RENAME TO ai_review;
    CREATE TABLE ai_review_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        report_markdown TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    INSERT INTO ai_review_version (review_id, version_number, report_markdown, created_at)
        SELECT id, 1, report_markdown, updated_at FROM ai_review;
    CREATE TABLE ai_chat_message_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id INTEGER,
        repo TEXT NOT NULL COLLATE NOCASE,
        branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        quoted_text TEXT,
        cost_usd TEXT,
        created_at INTEGER NOT NULL
    );
    INSERT INTO ai_chat_message_new (id, repo, branch, target_branch, role, content, quoted_text, cost_usd, created_at)
        SELECT id, repo, branch, target_branch, role, content, quoted_text, cost_usd, created_at FROM ai_chat_message;
    DROP TABLE ai_chat_message;
    ALTER TABLE ai_chat_message_new RENAME TO ai_chat_message;
    UPDATE ai_chat_message SET review_id = (
        SELECT id FROM ai_review
        WHERE ai_review.repo = ai_chat_message.repo COLLATE NOCASE
          AND ai_review.branch = ai_chat_message.branch
          AND ai_review.target_branch = ai_chat_message.target_branch
        ORDER BY id DESC LIMIT 1
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoredAiReviewVersion {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub review_id: i64,
    #[ts(type = "number")]
    pub version_number: i64,
    pub report_markdown: String,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoredAiReview {
    #[ts(type = "number")]
    pub id: i64,
    pub repo: String,
    pub branch: String,
    pub target_branch: String,
    pub report_markdown: String,
    pub cost_usd: Option<String>,
    pub head_oid: Option<String>,
    pub base_oid: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    pub versions: Vec<StoredAiReviewVersion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoredAiChatMessage {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number | null")]
    pub review_id: Option<i64>,
    pub repo: String,
    pub branch: String,
    pub target_branch: String,
    pub role: String,
    pub content: String,
    pub quoted_text: Option<String>,
    pub cost_usd: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
}

pub struct NewAiChatMessage<'a> {
    pub review_id: Option<i64>,
    pub repo: &'a str,
    pub branch: &'a str,
    pub target_branch: &'a str,
    pub role: &'a str,
    pub content: &'a str,
    pub quoted_text: Option<&'a str>,
    pub cost_usd: Option<&'a str>,
    pub created_at: i64,
}

pub fn accumulate_cost(existing: Option<&str>, addition: Option<&str>) -> Option<String> {
    match (existing, addition) {
        (Some(e), Some(a)) => {
            let e_val: f64 = e.trim().parse().unwrap_or(0.0);
            let a_val: f64 = a.trim().parse().unwrap_or(0.0);
            let sum = e_val + a_val;
            if sum <= 0.0 {
                Some("0.00".to_string())
            } else {
                let formatted = format!("{:.4}", sum);
                let trimmed = formatted.trim_end_matches('0');
                let res = if trimmed.ends_with('.') {
                    format!("{trimmed}00")
                } else if trimmed.split('.').nth(1).map_or(0, |f| f.len()) < 2 {
                    format!("{trimmed}0")
                } else {
                    trimmed.to_string()
                };
                Some(res)
            }
        }
        (Some(e), None) => Some(e.to_string()),
        (None, Some(a)) => Some(a.to_string()),
        (None, None) => None,
    }
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

    pub fn recover_newer(dir: &Path) -> Result<Store> {
        Store::recover_newer_with(dir, &CURRENT)
    }

    pub fn recover_newer_with(dir: &Path, migrations: &Migrations) -> Result<Store> {
        fs::create_dir_all(dir)?;
        let db_path = dir.join(STATE_FILE);
        let settings_path = dir.join(SETTINGS_FILE);
        let (raw, _) = read_settings(&settings_path);
        let settings_from = settings_version(&raw);
        let (state_from, backup) = if db_path.exists() {
            let db = Connection::open(&db_path)?;
            db.pragma_update(None, "journal_mode", "WAL")?;
            let state_from = user_version(&db)?;
            let from = written_by(&db);
            let backup = back_up(dir, &db, from)?;
            (state_from, Some(backup))
        } else {
            (0, None)
        };
        if let Some(candidate) = find_compatible_backup(dir, backup.as_deref(), migrations) {
            if settings_from > migrations.settings.len()
                && !candidate.join(SETTINGS_FILE).exists()
                && settings_path.exists()
            {
                fs::remove_file(&settings_path)?;
            }
            restore(dir, &candidate)?;
            let mut store = Store::open_with(dir, migrations)?;
            if let Some(saved) = backup.as_deref() {
                store.notice = prepend_notice(
                    store.notice.take(),
                    format!(
                        "Diffloupe restored an earlier backup because your previous data could not be opened by this version ({APP_VERSION}). A copy of the previous data is in {}.",
                        saved.display()
                    ),
                );
            }
            return Ok(store);
        }
        if state_from > migrations.state.len() {
            remove_state_files(dir)?;
        }
        if settings_from > migrations.settings.len() && settings_path.exists() {
            fs::remove_file(&settings_path)?;
        }
        let mut store = Store::open_with(dir, migrations)?;
        if let Some(saved) = backup.as_deref() {
            store.notice = prepend_notice(
                store.notice.take(),
                format!(
                    "Diffloupe started with fresh data because your previous data could not be opened by this version ({APP_VERSION}). A copy of the previous data is in {}.",
                    saved.display()
                ),
            );
        }
        Ok(store)
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
        let path = clean_path(path);
        self.db.execute(
            "DELETE FROM recent WHERE path = ?1 COLLATE NOCASE AND path <> ?1",
            params![path],
        )?;
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
        let path = clean_path(path);
        self.db.execute(
            "DELETE FROM recent WHERE path = ?1 COLLATE NOCASE",
            params![path],
        )?;
        Ok(())
    }

    pub fn repo_state(&self, path: &str) -> Result<RepoState> {
        let path = clean_path(path);
        let row = self
            .db
            .query_row(
                "SELECT target_branch, last_tab, last_selection FROM repo_state WHERE path = ?1 COLLATE NOCASE",
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
        let path = clean_path(path);
        self.db.execute(
            "DELETE FROM repo_state WHERE path = ?1 COLLATE NOCASE AND path <> ?1",
            params![path],
        )?;
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
        let repo = clean_path(repo);
        self.db.execute(
            "UPDATE OR REPLACE commit_message SET repo = ?1 WHERE repo = ?1 COLLATE NOCASE AND repo <> ?1",
            params![repo],
        )?;
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
        let repo = clean_path(repo);
        let mut stmt = self.db.prepare(
            "SELECT message FROM commit_message WHERE repo = ?1 COLLATE NOCASE ORDER BY used_at DESC, message",
        )?;
        let rows = stmt.query_map(params![repo], |r| r.get(0))?;
        rows.collect::<std::result::Result<Vec<String>, _>>()
            .map_err(Error::from)
    }

    pub fn ai_consent(&self) -> Result<bool> {
        let row: Option<i64> = self
            .db
            .query_row("SELECT accepted_at FROM ai_consent WHERE id = 1", [], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(row.is_some())
    }

    pub fn set_ai_consent(&self, accepted: bool) -> Result<()> {
        if accepted {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            self.db.execute(
                "INSERT INTO ai_consent (id, accepted_at) VALUES (1, ?1)
                 ON CONFLICT(id) DO UPDATE SET accepted_at = excluded.accepted_at",
                params![now],
            )?;
        } else {
            self.db.execute("DELETE FROM ai_consent WHERE id = 1", [])?;
        }
        Ok(())
    }

    pub fn get_ai_review_versions(&self, review_id: i64) -> Result<Vec<StoredAiReviewVersion>> {
        let mut stmt = self.db.prepare(
            "SELECT id, review_id, version_number, report_markdown, created_at
             FROM ai_review_version WHERE review_id = ?1 ORDER BY version_number ASC",
        )?;
        let rows = stmt.query_map(params![review_id], |r| {
            Ok(StoredAiReviewVersion {
                id: r.get(0)?,
                review_id: r.get(1)?,
                version_number: r.get(2)?,
                report_markdown: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    pub fn get_ai_reviews(&self, repo: &str) -> Result<Vec<StoredAiReview>> {
        let repo = clean_path(repo);
        let mut stmt = self.db.prepare(
            "SELECT id, repo, branch, target_branch, report_markdown, cost_usd, head_oid, base_oid, model, effort, created_at, updated_at
             FROM ai_review WHERE repo = ?1 COLLATE NOCASE ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![repo], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, Option<String>>(9)?,
                r.get::<_, i64>(10)?,
                r.get::<_, i64>(11)?,
            ))
        })?;
        let mut list = Vec::new();
        for row in rows {
            let (
                id,
                repo,
                branch,
                target_branch,
                report_markdown,
                cost_usd,
                head_oid,
                base_oid,
                model,
                effort,
                created_at,
                updated_at,
            ) = row?;
            let versions = self.get_ai_review_versions(id)?;
            list.push(StoredAiReview {
                id,
                repo,
                branch,
                target_branch,
                report_markdown,
                cost_usd,
                head_oid,
                base_oid,
                model,
                effort,
                created_at,
                updated_at,
                versions,
            });
        }
        Ok(list)
    }

    pub fn get_ai_review(&self, review_id: i64) -> Result<Option<StoredAiReview>> {
        let row = self
            .db
            .query_row(
                "SELECT id, repo, branch, target_branch, report_markdown, cost_usd, head_oid, base_oid, model, effort, created_at, updated_at
                 FROM ai_review WHERE id = ?1",
                params![review_id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, Option<String>>(5)?,
                        r.get::<_, Option<String>>(6)?,
                        r.get::<_, Option<String>>(7)?,
                        r.get::<_, Option<String>>(8)?,
                        r.get::<_, Option<String>>(9)?,
                        r.get::<_, i64>(10)?,
                        r.get::<_, i64>(11)?,
                    ))
                },
            )
            .optional()?;

        match row {
            Some((
                id,
                repo,
                branch,
                target_branch,
                report_markdown,
                cost_usd,
                head_oid,
                base_oid,
                model,
                effort,
                created_at,
                updated_at,
            )) => {
                let versions = self.get_ai_review_versions(id)?;
                Ok(Some(StoredAiReview {
                    id,
                    repo,
                    branch,
                    target_branch,
                    report_markdown,
                    cost_usd,
                    head_oid,
                    base_oid,
                    model,
                    effort,
                    created_at,
                    updated_at,
                    versions,
                }))
            }
            None => Ok(None),
        }
    }

    pub fn get_latest_ai_review(
        &self,
        repo: &str,
        branch: Option<&str>,
        target_branch: Option<&str>,
    ) -> Result<Option<StoredAiReview>> {
        let repo = clean_path(repo);
        let id_opt: Option<i64> = match (branch, target_branch) {
            (Some(b), Some(t)) => self
                .db
                .query_row(
                    "SELECT id FROM ai_review WHERE repo = ?1 COLLATE NOCASE AND branch = ?2 AND target_branch = ?3 ORDER BY id DESC LIMIT 1",
                    params![repo, b, t],
                    |r| r.get(0),
                )
                .optional()?,
            _ => self
                .db
                .query_row(
                    "SELECT id FROM ai_review WHERE repo = ?1 COLLATE NOCASE ORDER BY id DESC LIMIT 1",
                    params![repo],
                    |r| r.get(0),
                )
                .optional()?,
        };
        match id_opt {
            Some(id) => self.get_ai_review(id),
            None => Ok(None),
        }
    }

    pub fn save_ai_review(&self, review: &StoredAiReview) -> Result<i64> {
        let repo = clean_path(&review.repo);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let updated_at = if review.updated_at > 0 {
            review.updated_at
        } else {
            now
        };
        let created_at = if review.created_at > 0 {
            review.created_at
        } else {
            now
        };

        if review.id > 0 {
            self.db.execute(
                "UPDATE ai_review SET
                    report_markdown = ?2,
                    cost_usd = ?3,
                    head_oid = ?4,
                    base_oid = ?5,
                    model = ?6,
                    effort = ?7,
                    updated_at = ?8
                 WHERE id = ?1",
                params![
                    review.id,
                    review.report_markdown,
                    review.cost_usd,
                    review.head_oid,
                    review.base_oid,
                    review.model,
                    review.effort,
                    updated_at,
                ],
            )?;

            let latest_version_report: Option<String> = self
                .db
                .query_row(
                    "SELECT report_markdown FROM ai_review_version WHERE review_id = ?1 ORDER BY version_number DESC LIMIT 1",
                    params![review.id],
                    |r| r.get(0),
                )
                .optional()?;

            if latest_version_report.as_deref() != Some(&review.report_markdown) {
                let max_version: i64 = self
                    .db
                    .query_row(
                        "SELECT COALESCE(MAX(version_number), 0) FROM ai_review_version WHERE review_id = ?1",
                        params![review.id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                self.db.execute(
                    "INSERT INTO ai_review_version (review_id, version_number, report_markdown, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![review.id, max_version + 1, review.report_markdown, updated_at],
                )?;
            }

            Ok(review.id)
        } else {
            self.db.execute(
                "INSERT INTO ai_review (repo, branch, target_branch, report_markdown, cost_usd, head_oid, base_oid, model, effort, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    repo,
                    review.branch,
                    review.target_branch,
                    review.report_markdown,
                    review.cost_usd,
                    review.head_oid,
                    review.base_oid,
                    review.model,
                    review.effort,
                    created_at,
                    updated_at,
                ],
            )?;
            let id = self.db.last_insert_rowid();
            self.db.execute(
                "INSERT INTO ai_review_version (review_id, version_number, report_markdown, created_at)
                 VALUES (?1, 1, ?2, ?3)",
                params![id, review.report_markdown, updated_at],
            )?;
            Ok(id)
        }
    }

    pub fn delete_ai_review(&self, review_id: i64) -> Result<()> {
        self.db.execute(
            "DELETE FROM ai_review_version WHERE review_id = ?1",
            params![review_id],
        )?;
        self.db.execute(
            "DELETE FROM ai_chat_message WHERE review_id = ?1",
            params![review_id],
        )?;
        self.db
            .execute("DELETE FROM ai_review WHERE id = ?1", params![review_id])?;
        Ok(())
    }

    pub fn revert_ai_review_version(
        &self,
        review_id: i64,
        version_number: i64,
    ) -> Result<Option<StoredAiReview>> {
        let version_row: Option<String> = self
            .db
            .query_row(
                "SELECT report_markdown FROM ai_review_version WHERE review_id = ?1 AND version_number = ?2",
                params![review_id, version_number],
                |r| r.get(0),
            )
            .optional()?;

        let Some(target_report) = version_row else {
            return Ok(None);
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let max_version: i64 = self
            .db
            .query_row(
                "SELECT COALESCE(MAX(version_number), 0) FROM ai_review_version WHERE review_id = ?1",
                params![review_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        self.db.execute(
            "INSERT INTO ai_review_version (review_id, version_number, report_markdown, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![review_id, max_version + 1, target_report, now],
        )?;

        self.db.execute(
            "UPDATE ai_review SET report_markdown = ?2, updated_at = ?3 WHERE id = ?1",
            params![review_id, target_report, now],
        )?;

        self.get_ai_review(review_id)
    }

    pub fn get_ai_chat_messages(
        &self,
        review_id: Option<i64>,
        repo: &str,
        branch: &str,
        target_branch: &str,
    ) -> Result<Vec<StoredAiChatMessage>> {
        let repo = clean_path(repo);
        let rows = if let Some(rid) = review_id {
            let mut stmt = self.db.prepare(
                "SELECT id, review_id, repo, branch, target_branch, role, content, quoted_text, cost_usd, created_at
                 FROM ai_chat_message WHERE review_id = ?1
                 ORDER BY id ASC",
            )?;
            let mapped = stmt.query_map(params![rid], |r| {
                Ok(StoredAiChatMessage {
                    id: r.get(0)?,
                    review_id: r.get(1)?,
                    repo: r.get(2)?,
                    branch: r.get(3)?,
                    target_branch: r.get(4)?,
                    role: r.get(5)?,
                    content: r.get(6)?,
                    quoted_text: r.get(7)?,
                    cost_usd: r.get(8)?,
                    created_at: r.get(9)?,
                })
            })?;
            mapped.collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            let mut stmt = self.db.prepare(
                "SELECT id, review_id, repo, branch, target_branch, role, content, quoted_text, cost_usd, created_at
                 FROM ai_chat_message WHERE repo = ?1 COLLATE NOCASE AND branch = ?2 AND target_branch = ?3
                 ORDER BY id ASC",
            )?;
            let mapped = stmt.query_map(params![repo, branch, target_branch], |r| {
                Ok(StoredAiChatMessage {
                    id: r.get(0)?,
                    review_id: r.get(1)?,
                    repo: r.get(2)?,
                    branch: r.get(3)?,
                    target_branch: r.get(4)?,
                    role: r.get(5)?,
                    content: r.get(6)?,
                    quoted_text: r.get(7)?,
                    cost_usd: r.get(8)?,
                    created_at: r.get(9)?,
                })
            })?;
            mapped.collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok(rows)
    }

    pub fn append_ai_chat_message(
        &self,
        msg: &NewAiChatMessage<'_>,
    ) -> Result<StoredAiChatMessage> {
        let repo = clean_path(msg.repo);
        self.db.execute(
            "INSERT INTO ai_chat_message (review_id, repo, branch, target_branch, role, content, quoted_text, cost_usd, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                msg.review_id,
                repo,
                msg.branch,
                msg.target_branch,
                msg.role,
                msg.content,
                msg.quoted_text,
                msg.cost_usd,
                msg.created_at
            ],
        )?;
        let id = self.db.last_insert_rowid();
        Ok(StoredAiChatMessage {
            id,
            review_id: msg.review_id,
            repo,
            branch: msg.branch.to_string(),
            target_branch: msg.target_branch.to_string(),
            role: msg.role.to_string(),
            content: msg.content.to_string(),
            quoted_text: msg.quoted_text.map(|s| s.to_string()),
            cost_usd: msg.cost_usd.map(|s| s.to_string()),
            created_at: msg.created_at,
        })
    }

    pub fn clear_ai_chat_thread(
        &self,
        review_id: Option<i64>,
        repo: &str,
        branch: &str,
        target_branch: &str,
    ) -> Result<()> {
        let repo = clean_path(repo);
        if let Some(rid) = review_id {
            self.db.execute(
                "DELETE FROM ai_chat_message WHERE review_id = ?1",
                params![rid],
            )?;
        } else {
            self.db.execute(
                "DELETE FROM ai_chat_message WHERE repo = ?1 COLLATE NOCASE AND branch = ?2 AND target_branch = ?3",
                params![repo, branch, target_branch],
            )?;
        }
        Ok(())
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

fn clean_path(path: &str) -> String {
    let stripped = path.strip_prefix(r"\\?\").unwrap_or(path);
    let bytes = stripped.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
    {
        let drive = char::from(bytes[0].to_ascii_uppercase());
        let rest = stripped[2..].replace('/', "\\");
        let rest = rest.trim_end_matches('\\');
        return if rest.is_empty() {
            format!("{drive}:\\")
        } else {
            format!("{drive}:{rest}")
        };
    }
    stripped.to_string()
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

pub fn is_same_version_newer(dir: &Path) -> bool {
    let db_path = dir.join(STATE_FILE);
    if !db_path.exists() {
        return false;
    }
    let Ok(db) = Connection::open(&db_path) else {
        return false;
    };
    written_by(&db).as_deref() == Some(APP_VERSION)
}

fn find_compatible_backup(
    dir: &Path,
    skip: Option<&Path>,
    migrations: &Migrations,
) -> Option<PathBuf> {
    let root = dir.join(BACKUPS_DIR);
    let entries = fs::read_dir(root).ok()?;
    let mut candidates: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.is_dir() && skip != Some(path.as_path()))
        .collect();
    candidates.sort();
    candidates.reverse();
    candidates
        .into_iter()
        .find(|candidate| backup_is_compatible(candidate, migrations))
}

fn backup_is_compatible(candidate: &Path, migrations: &Migrations) -> bool {
    let db_path = candidate.join(STATE_FILE);
    if !db_path.exists() {
        return false;
    }
    let Ok(db) = Connection::open(&db_path) else {
        return false;
    };
    let Ok(state_version) = user_version(&db) else {
        return false;
    };
    if state_version > migrations.state.len() {
        return false;
    }
    let settings_path = candidate.join(SETTINGS_FILE);
    if settings_path.exists() {
        let (raw, _) = read_settings(&settings_path);
        if settings_version(&raw) > migrations.settings.len() {
            return false;
        }
    }
    true
}

fn remove_state_files(dir: &Path) -> Result<()> {
    for suffix in ["", "-wal", "-shm"] {
        let path = dir.join(format!("{STATE_FILE}{suffix}"));
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn prepend_notice(existing: Option<String>, message: String) -> Option<String> {
    match existing {
        Some(rest) => Some(format!("{message} {rest}")),
        None => Some(message),
    }
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

    #[test]
    fn recent_list_and_repo_state_normalise_windows_paths_and_ignore_case() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        store
            .touch_recent(r"\\?\c:\Work\My Repo\", "My Repo", Some("main"), 1)
            .unwrap();
        store
            .set_repo_state(
                r"C:\Work\My Repo",
                &RepoState {
                    target_branch: Some("main".into()),
                    last_tab: Some("log".into()),
                    last_selection: None,
                },
            )
            .unwrap();
        store
            .touch_recent(r"C:/work/my repo", "My Repo", Some("dev"), 2)
            .unwrap();
        let recent = store.recent().unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].path, r"C:\work\my repo");
        assert_eq!(recent[0].branch.as_deref(), Some("dev"));
        assert_eq!(
            store
                .repo_state(r"c:\WORK\MY REPO")
                .unwrap()
                .last_tab
                .as_deref(),
            Some("log")
        );
        store
            .add_commit_message(r"C:\Work\My Repo", "Fix invoice total", 10)
            .unwrap();
        store
            .add_commit_message(r"c:\work\my repo", "Fix invoice total", 20)
            .unwrap();
        assert_eq!(
            store.commit_messages(r"C:\WORK\MY REPO").unwrap(),
            vec!["Fix invoice total"]
        );
        store.remove_recent(r"C:\WORK\MY REPO").unwrap();
        assert!(store.recent().unwrap().is_empty());
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

    #[test]
    fn ai_review_history_versions_and_cost_accumulation() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();

        assert_eq!(
            accumulate_cost(Some("0.14"), Some("0.02")).as_deref(),
            Some("0.16")
        );
        assert_eq!(
            accumulate_cost(Some("0.16"), Some("0.005")).as_deref(),
            Some("0.165")
        );

        let rev1_id = store
            .save_ai_review(&StoredAiReview {
                id: 0,
                repo: "/repo".into(),
                branch: "feat".into(),
                target_branch: "main".into(),
                report_markdown: "# Report v1".into(),
                cost_usd: Some("0.14".into()),
                head_oid: Some("head1".into()),
                base_oid: Some("base1".into()),
                model: Some("claude".into()),
                effort: Some("medium".into()),
                created_at: 1000,
                updated_at: 1000,
                versions: Vec::new(),
            })
            .unwrap();
        assert!(rev1_id > 0);

        store
            .append_ai_chat_message(&NewAiChatMessage {
                review_id: Some(rev1_id),
                repo: "/repo",
                branch: "feat",
                target_branch: "main",
                role: "user",
                content: "Can you fix X?",
                quoted_text: None,
                cost_usd: None,
                created_at: 1010,
            })
            .unwrap();

        store
            .append_ai_chat_message(&NewAiChatMessage {
                review_id: Some(rev1_id),
                repo: "/repo",
                branch: "feat",
                target_branch: "main",
                role: "assistant",
                content: "I updated the report.",
                quoted_text: None,
                cost_usd: Some("0.02"),
                created_at: 1020,
            })
            .unwrap();

        let mut r1 = store.get_ai_review(rev1_id).unwrap().unwrap();
        assert_eq!(r1.versions.len(), 1);
        assert_eq!(r1.versions[0].version_number, 1);
        assert_eq!(r1.report_markdown, "# Report v1");

        r1.report_markdown = "# Report v2 with fix".into();
        r1.cost_usd = accumulate_cost(r1.cost_usd.as_deref(), Some("0.02"));
        r1.updated_at = 1020;
        store.save_ai_review(&r1).unwrap();

        let r1_updated = store.get_ai_review(rev1_id).unwrap().unwrap();
        assert_eq!(r1_updated.cost_usd.as_deref(), Some("0.16"));
        assert_eq!(r1_updated.versions.len(), 2);
        assert_eq!(r1_updated.versions[1].version_number, 2);
        assert_eq!(
            r1_updated.versions[1].report_markdown,
            "# Report v2 with fix"
        );

        let r1_reverted = store.revert_ai_review_version(rev1_id, 1).unwrap().unwrap();
        assert_eq!(r1_reverted.report_markdown, "# Report v1");
        assert_eq!(r1_reverted.versions.len(), 3);

        let rev2_id = store
            .save_ai_review(&StoredAiReview {
                id: 0,
                repo: "/repo".into(),
                branch: "feat".into(),
                target_branch: "main".into(),
                report_markdown: "# Fresh Review".into(),
                cost_usd: Some("0.12".into()),
                head_oid: Some("head2".into()),
                base_oid: Some("base2".into()),
                model: Some("claude".into()),
                effort: Some("medium".into()),
                created_at: 2000,
                updated_at: 2000,
                versions: Vec::new(),
            })
            .unwrap();
        assert_ne!(rev1_id, rev2_id);

        let reviews = store.get_ai_reviews("/repo").unwrap();
        assert_eq!(reviews.len(), 2);
        assert_eq!(reviews[0].id, rev2_id);
        assert_eq!(reviews[1].id, rev1_id);

        let msgs_r1 = store
            .get_ai_chat_messages(Some(rev1_id), "/repo", "feat", "main")
            .unwrap();
        let msgs_r2 = store
            .get_ai_chat_messages(Some(rev2_id), "/repo", "feat", "main")
            .unwrap();
        assert_eq!(msgs_r1.len(), 2);
        assert_eq!(msgs_r2.len(), 0);

        store.delete_ai_review(rev1_id).unwrap();
        assert!(store.get_ai_review(rev1_id).unwrap().is_none());
        assert_eq!(store.get_ai_review_versions(rev1_id).unwrap().len(), 0);
        assert_eq!(
            store
                .get_ai_chat_messages(Some(rev1_id), "/repo", "feat", "main")
                .unwrap()
                .len(),
            0
        );

        let remaining = store.get_ai_reviews("/repo").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, rev2_id);
    }

    #[test]
    fn recover_newer_restores_compatible_backup_and_preserves_newer_data() {
        let dir = tempfile::tempdir().unwrap();
        let old_store = Store::open_with(dir.path(), &OLD).unwrap();
        old_store
            .touch_recent("/repo", "repo", Some("main"), 100)
            .unwrap();
        drop(old_store);

        let upgraded = Store::open(dir.path()).unwrap();
        assert_eq!(upgraded.schema_version().unwrap(), MIGRATIONS.len() as i64);
        drop(upgraded);
        assert_eq!(backups(dir.path()).len(), 1);

        assert!(matches!(
            Store::open_with(dir.path(), &OLD),
            Err(Error::NewerStore(_))
        ));

        let recovered = Store::recover_newer_with(dir.path(), &OLD).unwrap();
        assert_eq!(recovered.schema_version().unwrap(), OLD.state.len() as i64);
        assert!(
            recovered
                .notice()
                .unwrap()
                .contains("restored an earlier backup")
        );
        assert_eq!(recovered.recent().unwrap().len(), 1);
        drop(recovered);

        assert!(backups(dir.path()).len() >= 2);
        assert!(Store::open_with(dir.path(), &OLD).is_ok());
    }

    #[test]
    fn recover_newer_resets_when_no_compatible_backup_exists() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        store
            .touch_recent("/repo", "repo", Some("main"), 100)
            .unwrap();
        drop(store);
        assert!(backups(dir.path()).is_empty());

        assert!(matches!(
            Store::open_with(dir.path(), &OLD),
            Err(Error::NewerStore(_))
        ));

        let recovered = Store::recover_newer_with(dir.path(), &OLD).unwrap();
        assert_eq!(recovered.schema_version().unwrap(), OLD.state.len() as i64);
        assert!(
            recovered
                .notice()
                .unwrap()
                .contains("started with fresh data")
        );
        assert!(recovered.recent().unwrap().is_empty());
        drop(recovered);

        assert_eq!(backups(dir.path()).len(), 1);
        assert!(Store::open_with(dir.path(), &OLD).is_ok());
    }

    #[test]
    fn recover_newer_handles_newer_settings_version() {
        let dir = tempfile::tempdir().unwrap();
        drop(Store::open(dir.path()).unwrap());
        fs::write(dir.path().join(SETTINGS_FILE), r#"{"version": 9}"#).unwrap();
        assert!(matches!(Store::open(dir.path()), Err(Error::NewerStore(_))));

        let recovered = Store::recover_newer(dir.path()).unwrap();
        assert_eq!(
            recovered.settings().diff.viewer,
            Settings::default().diff.viewer
        );
        assert_eq!(backups(dir.path()).len(), 1);
        drop(recovered);
        assert!(Store::open(dir.path()).is_ok());
    }

    #[test]
    fn is_same_version_newer_detects_matching_app_version() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_same_version_newer(dir.path()));

        drop(Store::open(dir.path()).unwrap());
        assert!(is_same_version_newer(dir.path()));

        let db = Connection::open(dir.path().join(STATE_FILE)).unwrap();
        db.execute(
            "UPDATE meta SET value = '9.9.9' WHERE key = 'app_version'",
            [],
        )
        .unwrap();
        drop(db);
        assert!(!is_same_version_newer(dir.path()));
    }
}
