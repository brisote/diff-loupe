#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::NoEvents;
use diffloupe_core::testutil::test_env;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

const FIVE_K: &str =
    "src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts";
const TWENTY_K: &str = "src/vscode-dts/vscode.d.ts";

fn timed<T>(label: &str, limit: Duration, run: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let value = run();
    let took = start.elapsed();
    let mark = if took <= limit { "ok  " } else { "SLOW" };
    println!(
        "{mark} {label:<44} {:>7.1} ms (target {} ms)",
        took.as_secs_f64() * 1000.0,
        limit.as_millis()
    );
    value
}

#[test]
fn speed_targets_on_the_reference_repository() {
    let Some(repo) = std::env::var_os("DIFFLOUPE_PERF_REPO").map(PathBuf::from) else {
        return;
    };
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
    let call = |cmd: &str, args: Value| core.dispatch(cmd, args).unwrap();
    let ms = Duration::from_millis;
    let info = timed("open_repo", ms(300), || {
        call("open_repo", json!({ "path": repo }))
    });
    let path = info["path"].clone();
    let quick = timed(
        "status, first read without untracked files",
        ms(300),
        || call("status", json!({ "path": path, "untracked": "skip" })),
    );
    println!(
        "     {} files in Changes",
        quick.as_array().map(Vec::len).unwrap_or(0)
    );
    timed(
        "status, full read (also each watcher refresh)",
        ms(1000),
        || call("status", json!({ "path": path })),
    );
    let diff = timed("diff of the 5,000-line file", ms(100), || {
        call(
            "diff",
            json!({ "path": path, "file": FIVE_K, "oldPath": null }),
        )
    });
    println!(
        "     {} blocks",
        diff["blocks"].as_array().map(Vec::len).unwrap_or(0)
    );
    timed("diff of the 5,000-line file (cached)", ms(100), || {
        call(
            "diff",
            json!({ "path": path, "file": FIVE_K, "oldPath": null }),
        )
    });
    timed("diff of the 21,000-line file", ms(250), || {
        call(
            "diff",
            json!({ "path": path, "file": TWENTY_K, "oldPath": null }),
        )
    });
    let log = timed("branch_log", ms(150), || {
        call("branch_log", json!({ "path": path }))
    });
    let entries = log["entries"].as_array().cloned().unwrap_or_default();
    println!("     {} commits in the log", entries.len());
    if let Some(first) = entries.first() {
        timed("commit_details of the newest commit", ms(150), || {
            call("commit_details", json!({ "path": path, "id": first["id"] }))
        });
    }
}
