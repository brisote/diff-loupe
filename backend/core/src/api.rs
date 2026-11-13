use crate::platform::Platform;
use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ToolTab {
    Review,
    Log,
    Changes,
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
    #[serde(default)]
    #[ts(optional)]
    pub target: Option<bool>,
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
    #[serde(default)]
    #[ts(optional)]
    pub local: Option<bool>,
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

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SaveFileArgs {
    pub path: String,
    pub file: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloudAccount {
    pub id: String,
    pub email: String,
    pub balance_usd: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiGetStateArgs {
    pub repo: String,
    #[serde(default)]
    #[ts(optional)]
    pub branch: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub target_branch: Option<String>,
    #[serde(default)]
    #[ts(type = "number | null", optional)]
    pub review_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiState {
    pub consent_accepted: bool,
    pub account: Option<CloudAccount>,
    pub reviews: Vec<crate::store::StoredAiReview>,
    #[ts(type = "number | null")]
    pub active_review_id: Option<i64>,
    pub review: Option<crate::store::StoredAiReview>,
    pub chat_messages: Vec<crate::store::StoredAiChatMessage>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiSetConsentArgs {
    pub accepted: bool,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiSignInArgs {}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiSignInResult {
    pub user_code: String,
    pub verification_url: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiAddFundsArgs {
    pub amount_usd: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiAddFundsResult {
    pub checkout_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelOption {
    pub id: String,
    pub name: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EffortOption {
    pub id: String,
    pub name: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelsCatalog {
    pub models: Vec<ModelOption>,
    pub efforts: Vec<EffortOption>,
    #[serde(alias = "default_model")]
    pub default_model: String,
    #[serde(alias = "default_effort")]
    pub default_effort: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiStartReviewArgs {
    pub repo: String,
    #[serde(default)]
    #[ts(optional)]
    pub branch: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub target_branch: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub model: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiSendFollowupArgs {
    pub repo: String,
    #[serde(default)]
    #[ts(optional)]
    pub branch: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub target_branch: Option<String>,
    #[serde(default)]
    #[ts(type = "number | null", optional)]
    pub review_id: Option<i64>,
    pub prompt: String,
    #[serde(default)]
    #[ts(optional)]
    pub quoted_text: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub section_heading: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiClearThreadArgs {
    pub repo: String,
    pub branch: String,
    pub target_branch: String,
    #[serde(default)]
    #[ts(type = "number | null", optional)]
    pub review_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiDeleteReviewArgs {
    #[ts(type = "number")]
    pub review_id: i64,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiRevertVersionArgs {
    #[ts(type = "number")]
    pub review_id: i64,
    #[ts(type = "number")]
    pub version_number: i64,
}
