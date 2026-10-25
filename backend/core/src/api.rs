use crate::platform::Platform;
use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ToolTab {
    Changes,
    Log,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub settings_notice: Option<String>,
    pub home: Option<String>,
    pub platform: Platform,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReportEnv {
    pub version: String,
    pub os: Option<String>,
    pub arch: String,
    pub git: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub target: Option<String>,
    pub default_branch: Option<String>,
    pub watch_error: Option<String>,
    pub watch_polling: bool,
    pub last_tab: ToolTab,
    pub last_selection: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    #[ts(type = "number")]
    pub last_opened: i64,
    pub exists: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PathArgs {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StatusArgs {
    pub path: String,
    #[serde(default)]
    #[ts(optional)]
    pub untracked: Option<crate::status::Untracked>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SettingsArgs {
    pub settings: Settings,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoViewArgs {
    pub path: String,
    pub tab: ToolTab,
    pub selection: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffArgs {
    pub path: String,
    pub file: String,
    pub old_path: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub commit: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub area: Option<crate::filediff::Area>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitIdArgs {
    pub path: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitArgs {
    pub path: String,
    pub message: String,
    pub amend: bool,
    pub files: Vec<String>,
    #[serde(default)]
    pub staged: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RollbackArgs {
    pub path: String,
    pub files: Vec<String>,
    #[serde(default)]
    pub delete_added: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchArgs {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskArgs {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VersionArgs {
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PrepareArgs {
    pub path: String,
    pub files: Vec<crate::filediff::DiffTarget>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TargetArgs {
    pub path: String,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UiKeyArgs {
    pub key: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UiValueArgs {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalOpenArgs {
    pub path: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalWriteArgs {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalResizeArgs {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalAckArgs {
    pub id: String,
    pub bytes: u32,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImageArgs {
    pub path: String,
    pub document: String,
    pub source: String,
    pub rev: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AcceptArgs {
    pub path: String,
    pub files: Vec<String>,
    pub side: crate::merge::MergeSide,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MergeFileArgs {
    pub path: String,
    pub file: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApplyMergeArgs {
    pub path: String,
    pub file: String,
    pub text: String,
    pub crlf: bool,
}
