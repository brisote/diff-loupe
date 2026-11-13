use std::io::{BufRead, Write};
use std::path::Path;

use crate::api::CloudAccount;
use crate::error::{Error, Result};
use crate::events::{AiStreamPayload, CoreEvent, EventSink, Task};
use crate::filediff;
use crate::gitops::Watch;
use crate::shellenv::ShellEnv;
use crate::store::{Store, StoredAiReview};
use serde::{Deserialize, Serialize};

pub const CLOUD_AUTH_FILE: &str = "cloud_auth.json";
pub const AI_SIGN_IN_TASK: &str = "ai_sign_in";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCloudAuth {
    pub access_token: String,
    pub account: CloudAccount,
}

pub fn read_auth(data_dir: &Path) -> Option<StoredCloudAuth> {
    let path = data_dir.join(CLOUD_AUTH_FILE);
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_auth(data_dir: &Path, auth: &StoredCloudAuth) -> Result<()> {
    let path = data_dir.join(CLOUD_AUTH_FILE);
    let json = serde_json::to_vec_pretty(auth)?;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts.open(&path)?;
    file.write_all(&json)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn clear_auth(data_dir: &Path) {
    let path = data_dir.join(CLOUD_AUTH_FILE);
    let _ = std::fs::remove_file(path);
}

pub fn create_archive(
    env: &ShellEnv,
    root: &Path,
    data_dir: &Path,
) -> Result<tempfile::NamedTempFile> {
    let output = env
        .git(root)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .output()?;
    if !output.status.success() {
        return Err(Error::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    let temp_file = tempfile::NamedTempFile::new_in(data_dir)?;
    let gz = flate2::write::GzEncoder::new(temp_file, flate2::Compression::default());
    let mut builder = tar::Builder::new(gz);

    for path_bytes in output.stdout.split(|&b| b == 0) {
        if path_bytes.is_empty() {
            continue;
        }
        let rel_str = match std::str::from_utf8(path_bytes) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if rel_str == ".git" || rel_str.starts_with(".git/") || rel_str.starts_with(".git\\") {
            continue;
        }
        let full = root.join(rel_str);
        let meta = match std::fs::symlink_metadata(&full) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_file() {
            if meta.len() as usize > filediff::SIZE_LIMIT {
                continue;
            }
            if let Ok(mut file) = std::fs::File::open(&full) {
                let mut header = tar::Header::new_gnu();
                header.set_size(meta.len());
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    header.set_mode(meta.permissions().mode());
                }
                #[cfg(not(unix))]
                {
                    header.set_mode(0o644);
                }
                header.set_cksum();
                let _ = builder.append_data(&mut header, rel_str, &mut file);
            }
        }
    }

    let gz = builder.into_inner()?;
    let temp = gz.finish()?;
    Ok(temp)
}

pub fn collect_commits(
    env: &ShellEnv,
    root: &Path,
    base: Option<&str>,
    head: Option<&str>,
) -> Vec<serde_json::Value> {
    let range = match (base, head) {
        (Some(b), Some(h)) => format!("{b}..{h}"),
        (Some(b), None) => format!("{b}..HEAD"),
        _ => "HEAD".to_string(),
    };
    let output = env
        .git(root)
        .args([
            "log",
            &range,
            "--format=%H%x1f%s%x1f%an%x1f%at",
            "-n",
            "100",
        ])
        .output();
    let mut commits = Vec::new();
    if let Ok(out) = output
        && out.status.success()
    {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split('\x1f').collect();
            if parts.len() >= 4 {
                let timestamp: Option<i64> = parts[3].parse().ok();
                commits.push(serde_json::json!({
                    "oid": parts[0],
                    "message": parts[1],
                    "author": parts[2],
                    "timestamp": timestamp,
                }));
            }
        }
    }
    commits
}

pub fn collect_unified_diff(env: &ShellEnv, root: &Path, base: Option<&str>) -> String {
    let mut args = vec!["diff"];
    let range;
    if let Some(b) = base {
        range = format!("{b}...HEAD");
        args.push(&range);
    }
    let output = env.git(root).args(args).output();
    output
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

pub fn collect_changed_files(changes: &[crate::status::FileChange]) -> Vec<serde_json::Value> {
    changes
        .iter()
        .filter(|c| !c.unchanged)
        .map(|c| {
            let status = match c.kind {
                crate::status::ChangeKind::Modified => "modified",
                crate::status::ChangeKind::Added => "added",
                crate::status::ChangeKind::Deleted => "deleted",
                crate::status::ChangeKind::Renamed => "renamed",
                crate::status::ChangeKind::Copied => "copied",
                crate::status::ChangeKind::TypeChanged => "type_changed",
                crate::status::ChangeKind::Untracked => "untracked",
                crate::status::ChangeKind::Conflicted => "conflicted",
            };
            serde_json::json!({
                "path": c.path,
                "status": status,
                "oldPath": c.old_path,
                "additions": 0,
                "deletions": 0,
            })
        })
        .collect()
}

pub fn map_ureq_error(err: ureq::Error) -> Error {
    match err {
        ureq::Error::Status(401, _) => Error::AuthRequired,
        ureq::Error::Status(402, _) => Error::InsufficientBalance,
        ureq::Error::Status(403, _) => Error::ConsentRequired,
        ureq::Error::Status(code, resp) => {
            let text = resp
                .into_string()
                .unwrap_or_else(|_| format!("HTTP {code}"));
            let msg = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| {
                    v.get("message")
                        .or_else(|| v.get("detail"))
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or(text);
            Error::AiService(msg)
        }
        ureq::Error::Transport(t) => Error::AiService(t.to_string()),
    }
}

pub struct StreamContext<'a> {
    pub repo: &'a str,
    pub branch: &'a str,
    pub target_branch: &'a str,
    pub run_id: &'a str,
    pub head_oid: Option<&'a str>,
    pub base_oid: Option<&'a str>,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
    pub review_id: Option<i64>,
    pub data_dir: &'a Path,
}

#[derive(Default)]
struct StreamAccumulator {
    report: String,
    chat: String,
    cost_usd: Option<String>,
    terminal_seen: bool,
}

pub fn stream_sse(
    resp: ureq::Response,
    ctx: &StreamContext<'_>,
    watch: &Watch,
    events: &dyn EventSink,
    task: &mut Task,
    store: &Store,
) -> Result<()> {
    let reader = resp.into_reader();
    let mut buf = std::io::BufReader::new(reader);
    let mut line = String::new();
    let mut current_event: Option<String> = None;
    let mut current_data: Option<String> = None;
    let mut acc = StreamAccumulator::default();

    while buf.read_line(&mut line)? > 0 {
        watch.check()?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if let (Some(ev), Some(data)) = (current_event.take(), current_data.take()) {
                dispatch_sse_event(&ev, &data, ctx, events, task, store, &mut acc)?;
            }
        } else if let Some(ev) = trimmed.strip_prefix("event: ") {
            current_event = Some(ev.trim().to_string());
        } else if let Some(d) = trimmed.strip_prefix("data: ") {
            current_data = Some(d.trim().to_string());
        }
        line.clear();
    }

    if let (Some(ev), Some(data)) = (current_event.take(), current_data.take()) {
        dispatch_sse_event(&ev, &data, ctx, events, task, store, &mut acc)?;
    }

    if !acc.terminal_seen {
        events.emit(CoreEvent::AiReviewStream {
            repo: ctx.repo.to_string(),
            branch: ctx.branch.to_string(),
            target_branch: ctx.target_branch.to_string(),
            run_id: ctx.run_id.to_string(),
            event: AiStreamPayload::Error {
                code: "aiService".to_string(),
                message: "Review stream closed before completion".to_string(),
            },
        });
    }

    Ok(())
}

fn dispatch_sse_event(
    ev: &str,
    data: &str,
    ctx: &StreamContext<'_>,
    events: &dyn EventSink,
    task: &mut Task,
    store: &Store,
    acc: &mut StreamAccumulator,
) -> Result<()> {
    let val: serde_json::Value = serde_json::from_str(data)
        .map_err(|e| Error::AiService(format!("Invalid SSE JSON: {e}")))?;
    match ev {
        "stage" => {
            let stage = val["stage"].as_str().unwrap_or_default().to_string();
            let message = val["message"].as_str().unwrap_or_default().to_string();
            let thought = val["thought"].as_str().map(|s| s.to_string());
            task.progress(message.clone(), 0.5);
            events.emit(CoreEvent::AiReviewStream {
                repo: ctx.repo.to_string(),
                branch: ctx.branch.to_string(),
                target_branch: ctx.target_branch.to_string(),
                run_id: ctx.run_id.to_string(),
                event: AiStreamPayload::Stage {
                    stage,
                    message,
                    thought,
                },
            });
        }
        "report_delta" => {
            let content = val["content"].as_str().unwrap_or_default().to_string();
            let delta = val["delta"].as_str().unwrap_or_default().to_string();
            acc.report.push_str(&delta);
            events.emit(CoreEvent::AiReviewStream {
                repo: ctx.repo.to_string(),
                branch: ctx.branch.to_string(),
                target_branch: ctx.target_branch.to_string(),
                run_id: ctx.run_id.to_string(),
                event: AiStreamPayload::ReportDelta { content, delta },
            });
        }
        "report_update" => {
            let report_markdown = val["report_markdown"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            acc.report = report_markdown.clone();
            events.emit(CoreEvent::AiReviewStream {
                repo: ctx.repo.to_string(),
                branch: ctx.branch.to_string(),
                target_branch: ctx.target_branch.to_string(),
                run_id: ctx.run_id.to_string(),
                event: AiStreamPayload::ReportUpdate { report_markdown },
            });
        }
        "chat_delta" => {
            let content = val["content"].as_str().unwrap_or_default().to_string();
            let delta = val["delta"].as_str().unwrap_or_default().to_string();
            acc.chat.push_str(&delta);
            if !acc.chat.contains("--- REPORT UPDATE ---") {
                events.emit(CoreEvent::AiReviewStream {
                    repo: ctx.repo.to_string(),
                    branch: ctx.branch.to_string(),
                    target_branch: ctx.target_branch.to_string(),
                    run_id: ctx.run_id.to_string(),
                    event: AiStreamPayload::ChatDelta { content, delta },
                });
            }
        }
        "billing" => {
            let balance_usd = val["balance_usd"].as_str().unwrap_or_default().to_string();
            let cost_usd = val["cost_usd"].as_str().unwrap_or_default().to_string();
            acc.cost_usd = Some(cost_usd.clone());
            if let Some(mut auth) = read_auth(ctx.data_dir) {
                auth.account.balance_usd = balance_usd.clone();
                let _ = write_auth(ctx.data_dir, &auth);
            }
            events.emit(CoreEvent::AiReviewStream {
                repo: ctx.repo.to_string(),
                branch: ctx.branch.to_string(),
                target_branch: ctx.target_branch.to_string(),
                run_id: ctx.run_id.to_string(),
                event: AiStreamPayload::Billing {
                    balance_usd,
                    cost_usd,
                },
            });
        }
        "done" => {
            let report_markdown = val["report_markdown"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let chat_message = val["chat_message"].as_str().unwrap_or_default().to_string();
            let balance_usd = val["balance_usd"].as_str().unwrap_or_default().to_string();
            let cost_usd = val["cost_usd"].as_str().unwrap_or_default().to_string();
            if let Some(mut auth) = read_auth(ctx.data_dir) {
                auth.account.balance_usd = balance_usd.clone();
                let _ = write_auth(ctx.data_dir, &auth);
            }
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let final_report = if !report_markdown.is_empty() {
                report_markdown
            } else {
                acc.report.clone()
            };
            let raw_chat = if !chat_message.is_empty() {
                chat_message
            } else {
                acc.chat.clone()
            };
            let final_chat = raw_chat
                .split("--- REPORT UPDATE ---")
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            let turn_cost = if !cost_usd.is_empty() {
                Some(cost_usd)
            } else {
                acc.cost_usd.clone()
            };

            let mut active_review_id = ctx.review_id;
            if let Some(rid) = active_review_id {
                if let Ok(Some(existing)) = store.get_ai_review(rid) {
                    let accumulated = crate::store::accumulate_cost(
                        existing.cost_usd.as_deref(),
                        turn_cost.as_deref(),
                    );
                    let mut updated = existing;
                    if !final_report.is_empty() {
                        updated.report_markdown = final_report.clone();
                    }
                    updated.cost_usd = accumulated;
                    updated.updated_at = now;
                    let _ = store.save_ai_review(&updated);
                }
            } else if !final_report.is_empty() {
                let saved_id = store.save_ai_review(&StoredAiReview {
                    id: 0,
                    repo: ctx.repo.to_string(),
                    branch: ctx.branch.to_string(),
                    target_branch: ctx.target_branch.to_string(),
                    report_markdown: final_report.clone(),
                    cost_usd: turn_cost.clone(),
                    head_oid: ctx.head_oid.map(|s| s.to_string()),
                    base_oid: ctx.base_oid.map(|s| s.to_string()),
                    model: ctx.model.map(|s| s.to_string()),
                    effort: ctx.effort.map(|s| s.to_string()),
                    created_at: now,
                    updated_at: now,
                    versions: Vec::new(),
                });
                if let Ok(id) = saved_id {
                    active_review_id = Some(id);
                }
            }

            if !final_chat.is_empty() {
                let _ = store.append_ai_chat_message(&crate::store::NewAiChatMessage {
                    review_id: active_review_id,
                    repo: ctx.repo,
                    branch: ctx.branch,
                    target_branch: ctx.target_branch,
                    role: "assistant",
                    content: &final_chat,
                    quoted_text: None,
                    cost_usd: turn_cost.as_deref(),
                    created_at: now,
                });
            }
            acc.terminal_seen = true;
            events.emit(CoreEvent::AiReviewStream {
                repo: ctx.repo.to_string(),
                branch: ctx.branch.to_string(),
                target_branch: ctx.target_branch.to_string(),
                run_id: ctx.run_id.to_string(),
                event: AiStreamPayload::Done {
                    report_markdown: final_report,
                    chat_message: final_chat,
                    balance_usd,
                    cost_usd: turn_cost.unwrap_or_default(),
                },
            });
        }
        "error" => {
            acc.terminal_seen = true;
            let code = val["code"].as_str().unwrap_or("aiService").to_string();
            let message = val["message"].as_str().unwrap_or_default().to_string();
            events.emit(CoreEvent::AiReviewStream {
                repo: ctx.repo.to_string(),
                branch: ctx.branch.to_string(),
                target_branch: ctx.target_branch.to_string(),
                run_id: ctx.run_id.to_string(),
                event: AiStreamPayload::Error { code, message },
            });
        }
        _ => {}
    }
    Ok(())
}
