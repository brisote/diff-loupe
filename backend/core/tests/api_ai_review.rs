#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::aireview::{self, StoredCloudAuth};
use diffloupe_core::api::CloudAccount;
use diffloupe_core::error::ErrorCode;
use diffloupe_core::events::{CoreEvent, RecordedEvents};
use diffloupe_core::testutil::{TempRepo, test_env};
use diffloupe_core::update::set_test_cloud_url;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Cursor, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct TestServer {
    url: String,
    _requests: Arc<Mutex<Vec<String>>>,
    shutdown: Arc<AtomicBool>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        set_test_cloud_url(None);
    }
}

fn spawn_server<F>(handler: F) -> TestServer
where
    F: Fn(&str, &str, &[u8], &mut TcpStream) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");
    set_test_cloud_url(Some(url.clone()));

    let requests = Arc::new(Mutex::new(Vec::new()));
    let requests_clone = requests.clone();
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    std::thread::spawn(move || {
        listener.set_nonblocking(true).expect("set nonblocking");
        while !shutdown_clone.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line.is_empty() {
                        continue;
                    }
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() < 2 {
                        continue;
                    }
                    let method = parts[0].to_string();
                    let path = parts[1].to_string();
                    requests_clone
                        .lock()
                        .unwrap()
                        .push(format!("{method} {path}"));

                    let mut content_length = 0usize;
                    loop {
                        line.clear();
                        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                            break;
                        }
                        if let Some(val) = line.to_lowercase().strip_prefix("content-length:") {
                            content_length = val.trim().parse().unwrap_or(0);
                        }
                    }

                    let mut body = vec![0u8; content_length];
                    if content_length > 0 {
                        let _ = reader.read_exact(&mut body);
                    }

                    handler(&method, &path, &body, &mut stream);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });

    TestServer {
        url,
        _requests: requests,
        shutdown,
    }
}

fn open_repo_core(repo: &TempRepo) -> (tempfile::TempDir, Core, Arc<RecordedEvents>, Value) {
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    let info = core
        .dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    (data, core, events, info["path"].clone())
}

#[test]
fn consent_check_blocks_upload_and_followup() {
    let repo = TempRepo::with_commit();
    let (data, core, _, repo_path) = open_repo_core(&repo);

    let hits = Arc::new(AtomicUsize::new(0));
    let hits_clone = hits.clone();
    let server = spawn_server(move |_, _, _, stream| {
        hits_clone.fetch_add(1, Ordering::SeqCst);
        let resp = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        let _ = stream.write_all(resp.as_bytes());
    });
    core.set_cloud_url(&server.url);

    let state = core
        .dispatch("ai_get_state", json!({ "repo": repo_path }))
        .unwrap();
    assert_eq!(state["consentAccepted"], false);
    assert_eq!(state["account"], Value::Null);

    let start_err = core
        .dispatch("ai_start_review", json!({ "repo": repo_path }))
        .unwrap_err();
    assert_eq!(start_err.code, ErrorCode::ConsentRequired);

    let followup_err = core
        .dispatch(
            "ai_send_followup",
            json!({ "repo": repo_path, "prompt": "test" }),
        )
        .unwrap_err();
    assert_eq!(followup_err.code, ErrorCode::ConsentRequired);

    assert_eq!(hits.load(Ordering::SeqCst), 0);

    core.dispatch("ai_set_consent", json!({ "accepted": true }))
        .unwrap();
    let state = core
        .dispatch("ai_get_state", json!({ "repo": repo_path }))
        .unwrap();
    assert_eq!(state["consentAccepted"], true);

    let start_err2 = core
        .dispatch("ai_start_review", json!({ "repo": repo_path }))
        .unwrap_err();
    assert_eq!(start_err2.code, ErrorCode::AuthRequired);

    core.dispatch("ai_set_consent", json!({ "accepted": false }))
        .unwrap();
    let state = core
        .dispatch("ai_get_state", json!({ "repo": repo_path }))
        .unwrap();
    assert_eq!(state["consentAccepted"], false);

    drop(data);
}

#[test]
fn device_code_sign_in_and_sign_out_flow() {
    let repo = TempRepo::with_commit();
    let (data, core, _, repo_path) = open_repo_core(&repo);

    let poll_count = Arc::new(AtomicUsize::new(0));
    let poll_count_clone = poll_count.clone();

    let server = spawn_server(move |method, path, _, stream| {
        if method == "POST" && path == "/v1/auth/device" {
            let body = json!({
                "device_code": "dc_xyz",
                "user_code": "CODE-1234",
                "verification_url": "http://127.0.0.1/verify",
                "expires_in": 300,
                "poll_interval_ms": 50,
            })
            .to_string();
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(resp.as_bytes());
            let _ = stream.flush();
        } else if method == "POST" && path == "/v1/auth/token" {
            let n = poll_count_clone.fetch_add(1, Ordering::SeqCst);
            let body = if n == 0 {
                json!({ "status": "pending" }).to_string()
            } else {
                json!({
                    "status": "authorized",
                    "access_token": "token_secret_123",
                    "account": {
                        "id": "usr_ada",
                        "email": "ada@example.com",
                        "balance_usd": "25.00"
                    }
                })
                .to_string()
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(resp.as_bytes());
            let _ = stream.flush();
        } else if method == "POST" && path == "/v1/auth/logout" {
            let resp = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(resp.as_bytes());
            let _ = stream.flush();
        }
    });
    core.set_cloud_url(&server.url);

    let sign_in = core.dispatch("ai_sign_in", json!({})).unwrap();
    assert_eq!(sign_in["userCode"], "CODE-1234");
    assert_eq!(sign_in["verificationUrl"], "http://127.0.0.1/verify");

    let mut signed_in = false;
    for _ in 0..80 {
        std::thread::sleep(Duration::from_millis(50));
        let state = core
            .dispatch("ai_get_state", json!({ "repo": repo_path }))
            .unwrap();
        if !state["account"].is_null() {
            signed_in = true;
            assert_eq!(state["account"]["email"], "ada@example.com");
            assert_eq!(state["account"]["balanceUsd"], "25.00");
            break;
        }
    }
    assert!(signed_in, "sign in poll did not complete in time");

    core.dispatch("ai_sign_out", json!({})).unwrap();
    let state = core
        .dispatch("ai_get_state", json!({ "repo": repo_path }))
        .unwrap();
    assert_eq!(state["account"], Value::Null);

    drop(data);
}

#[test]
fn http_error_mappings() {
    let repo = TempRepo::with_commit();
    let (data, core, _, repo_path) = open_repo_core(&repo);

    core.dispatch("ai_set_consent", json!({ "accepted": true }))
        .unwrap();

    let auth = StoredCloudAuth {
        access_token: "test_tok".into(),
        account: CloudAccount {
            id: "usr_1".into(),
            email: "ada@example.com".into(),
            balance_usd: "10.00".into(),
        },
    };
    aireview::write_auth(data.path(), &auth).unwrap();

    let status_code = Arc::new(AtomicUsize::new(401));
    let status_code_clone = status_code.clone();

    let server = spawn_server(move |_, _, _, stream| {
        let code = status_code_clone.load(Ordering::SeqCst);
        let resp = match code {
            401 => "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n",
            402 => "HTTP/1.1 402 Payment Required\r\nContent-Length: 0\r\n\r\n",
            _ => {
                "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: 26\r\n\r\n{\"error\":\"service failed\"}"
            }
        };
        let _ = stream.write_all(resp.as_bytes());
    });
    core.set_cloud_url(&server.url);

    status_code.store(401, Ordering::SeqCst);
    let err_401 = core
        .dispatch("ai_start_review", json!({ "repo": repo_path }))
        .unwrap_err();
    eprintln!("err_401: {:?}", err_401);
    assert_eq!(err_401.code, ErrorCode::AuthRequired);

    status_code.store(402, Ordering::SeqCst);
    let err_402 = core
        .dispatch("ai_start_review", json!({ "repo": repo_path }))
        .unwrap_err();
    assert_eq!(err_402.code, ErrorCode::InsufficientBalance);

    status_code.store(500, Ordering::SeqCst);
    let err_500 = core
        .dispatch("ai_start_review", json!({ "repo": repo_path }))
        .unwrap_err();
    assert_eq!(err_500.code, ErrorCode::AiService);

    drop(data);
}

#[test]
fn working_tree_archive_contents() {
    let repo = TempRepo::new();
    repo.write(".gitignore", "*.log\nignored_dir/\n");
    repo.write("tracked.rs", "fn tracked() {}\n");
    repo.write("src/nested.rs", "pub fn nested() {}\n");
    repo.commit_all("Initial commit");

    repo.write("tracked.rs", "fn tracked() { println!(\"edit\"); }\n");
    repo.write("untracked.rs", "fn untracked() {}\n");
    repo.write("test.log", "some log\n");
    repo.write("ignored_dir/secret.txt", "secret\n");

    let (data, core, _, repo_path) = open_repo_core(&repo);

    core.dispatch("ai_set_consent", json!({ "accepted": true }))
        .unwrap();

    let auth = StoredCloudAuth {
        access_token: "test_tok".into(),
        account: CloudAccount {
            id: "usr_1".into(),
            email: "ada@example.com".into(),
            balance_usd: "10.00".into(),
        },
    };
    aireview::write_auth(data.path(), &auth).unwrap();

    let captured_body = Arc::new(Mutex::new(Vec::new()));
    let captured_body_clone = captured_body.clone();

    let server = spawn_server(move |_, path, body, stream| {
        if path == "/v1/reviews/stream" {
            *captured_body_clone.lock().unwrap() = body.to_vec();
            let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\nevent: done\ndata: {}\n\n";
            let _ = stream.write_all(resp.as_bytes());
        }
    });
    core.set_cloud_url(&server.url);

    core.dispatch("ai_start_review", json!({ "repo": repo_path }))
        .unwrap();

    let body = captured_body.lock().unwrap().clone();
    assert!(!body.is_empty(), "server should receive request body");

    let marker = b"filename=\"repo.tar.gz\"\r\nContent-Type: application/gzip\r\n\r\n";
    let start_idx = body
        .windows(marker.len())
        .position(|w| w == marker)
        .expect("archive header found")
        + marker.len();

    let end_marker = b"\r\n--";
    let end_idx = body[start_idx..]
        .windows(end_marker.len())
        .position(|w| w == end_marker)
        .expect("end of archive part")
        + start_idx;

    let archive_bytes = &body[start_idx..end_idx];

    let decoder = flate2::read::GzDecoder::new(Cursor::new(archive_bytes));
    let mut tar = tar::Archive::new(decoder);
    let mut entry_paths = Vec::new();
    for entry in tar.entries().unwrap() {
        let entry = entry.unwrap();
        let path = entry.path().unwrap().to_str().unwrap().replace('\\', "/");
        entry_paths.push(path);
    }

    assert!(entry_paths.contains(&"tracked.rs".to_string()));
    assert!(entry_paths.contains(&"untracked.rs".to_string()));
    assert!(entry_paths.contains(&"src/nested.rs".to_string()));
    assert!(entry_paths.contains(&".gitignore".to_string()));

    assert!(!entry_paths.contains(&"test.log".to_string()));
    assert!(!entry_paths.iter().any(|p| p.starts_with(".git/")));
    assert!(!entry_paths.iter().any(|p| p.starts_with("ignored_dir/")));

    drop(data);
}

#[test]
fn sse_streaming_and_persistence() {
    let repo = TempRepo::with_commit();
    let (data, core, events, repo_path) = open_repo_core(&repo);

    core.dispatch("ai_set_consent", json!({ "accepted": true }))
        .unwrap();

    let auth = StoredCloudAuth {
        access_token: "test_tok".into(),
        account: CloudAccount {
            id: "usr_1".into(),
            email: "ada@example.com".into(),
            balance_usd: "20.00".into(),
        },
    };
    aireview::write_auth(data.path(), &auth).unwrap();

    let server = spawn_server(move |_, path, _, stream| {
        if path == "/v1/reviews/stream" {
            let sse = "\
HTTP/1.1 200 OK\r\n\
Content-Type: text/event-stream\r\n\
Connection: close\r\n\
\r\n\
event: stage\r\n\
data: {\"stage\":\"analyzing\"}\r\n\
\r\n\
event: report_delta\r\n\
data: {\"delta\":\"# Code Review Report\\n\\nEverything looks clean.\"}\r\n\
\r\n\
event: billing\r\n\
data: {\"cost_usd\":\"0.05\",\"new_balance_usd\":\"19.95\"}\r\n\
\r\n\
event: done\r\n\
data: {}\r\n\
\r\n";
            let _ = stream.write_all(sse.as_bytes());
        } else if path == "/v1/reviews/followup" {
            let sse = "\
HTTP/1.1 200 OK\r\n\
Content-Type: text/event-stream\r\n\
Connection: close\r\n\
\r\n\
event: chat_delta\r\n\
data: {\"delta\":\"Here is more detail about the change.\"}\r\n\
\r\n\
event: billing\r\n\
data: {\"cost_usd\":\"0.02\",\"new_balance_usd\":\"19.93\"}\r\n\
\r\n\
event: done\r\n\
data: {}\r\n\
\r\n";
            let _ = stream.write_all(sse.as_bytes());
        }
    });
    core.set_cloud_url(&server.url);

    core.dispatch("ai_start_review", json!({ "repo": repo_path }))
        .unwrap();

    let state = core
        .dispatch("ai_get_state", json!({ "repo": repo_path }))
        .unwrap();
    let review = &state["review"];
    assert_eq!(
        review["reportMarkdown"],
        "# Code Review Report\n\nEverything looks clean."
    );
    assert_eq!(review["costUsd"], "0.05");

    let stream_events: Vec<_> = events
        .take()
        .into_iter()
        .filter(|e| matches!(e, CoreEvent::AiReviewStream { .. }))
        .collect();
    assert!(
        !stream_events.is_empty(),
        "should emit AiReviewStream events"
    );

    core.dispatch(
        "ai_send_followup",
        json!({
            "repo": repo_path,
            "prompt": "Can you elaborate?",
        }),
    )
    .unwrap();

    let state2 = core
        .dispatch("ai_get_state", json!({ "repo": repo_path }))
        .unwrap();
    let msgs = state2["chatMessages"].as_array().unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["role"], "user");
    assert_eq!(msgs[0]["content"], "Can you elaborate?");
    assert_eq!(msgs[1]["role"], "assistant");
    assert_eq!(msgs[1]["content"], "Here is more detail about the change.");
    assert_eq!(msgs[1]["costUsd"], "0.02");

    core.dispatch(
        "ai_clear_thread",
        json!({
            "repo": repo_path,
            "branch": "main",
            "targetBranch": "main"
        }),
    )
    .unwrap();
    let state3 = core
        .dispatch("ai_get_state", json!({ "repo": repo_path }))
        .unwrap();
    assert_eq!(state3["chatMessages"].as_array().unwrap().len(), 0);

    drop(data);
}

#[test]
fn cancellation_aborts_active_stream() {
    let repo = TempRepo::with_commit();
    let (data, core, events, repo_path) = open_repo_core(&repo);

    core.dispatch("ai_set_consent", json!({ "accepted": true }))
        .unwrap();

    let auth = StoredCloudAuth {
        access_token: "test_tok".into(),
        account: CloudAccount {
            id: "usr_1".into(),
            email: "ada@example.com".into(),
            balance_usd: "20.00".into(),
        },
    };
    aireview::write_auth(data.path(), &auth).unwrap();

    let server = spawn_server(move |_, _, _, stream| {
        let header = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n";
        let _ = stream.write_all(header.as_bytes());
        let _ = stream.write_all(b"event: stage\ndata: {\"stage\":\"analyzing\"}\n\n");
        std::thread::sleep(Duration::from_secs(5));
    });
    core.set_cloud_url(&server.url);

    let core_arc = Arc::new(core);
    let core_clone = core_arc.clone();
    let repo_path_clone = repo_path.clone();

    let worker = std::thread::spawn(move || {
        core_clone.dispatch("ai_start_review", json!({ "repo": repo_path_clone }))
    });

    let id = loop {
        let started = events.take().into_iter().find_map(|e| match e {
            CoreEvent::Task {
                id,
                cancellable: true,
                done: false,
                ..
            } => Some(id),
            _ => None,
        });
        if let Some(id) = started {
            break id;
        }
        std::thread::sleep(Duration::from_millis(20));
    };

    while core_arc.dispatch("cancel", json!({ "id": id })).unwrap() != json!(true) {
        std::thread::sleep(Duration::from_millis(20));
    }

    let res = worker.join().unwrap();
    assert!(res.is_err());
    let err = res.unwrap_err();
    assert_eq!(err.code, ErrorCode::Cancelled);

    drop(data);
}

#[test]
fn ai_add_funds_amount_validation() {
    let repo = TempRepo::with_commit();
    let (data, core, _, _) = open_repo_core(&repo);

    let auth = StoredCloudAuth {
        access_token: "test_tok".into(),
        account: CloudAccount {
            id: "usr_1".into(),
            email: "ada@example.com".into(),
            balance_usd: "10.00".into(),
        },
    };
    aireview::write_auth(data.path(), &auth).unwrap();

    let server = spawn_server(move |_, path, body, stream| {
        if path == "/v1/billing/checkout-session" {
            let json: Value = serde_json::from_slice(body).unwrap();
            let amount = json["amount_usd"].as_i64().unwrap();
            let resp_body = json!({
                "checkout_url": format!("https://cloud.diffloupe.com/checkout/{amount}")
            })
            .to_string();
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{resp_body}",
                resp_body.len()
            );
            let _ = stream.write_all(resp.as_bytes());
        }
    });
    core.set_cloud_url(&server.url);

    let res = core
        .dispatch("ai_add_funds", json!({ "amountUsd": 25 }))
        .unwrap();
    assert_eq!(
        res["checkoutUrl"],
        "https://cloud.diffloupe.com/checkout/25"
    );

    let err = core
        .dispatch("ai_add_funds", json!({ "amountUsd": 15 }))
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidArgs);

    drop(data);
}
