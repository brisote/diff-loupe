#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::RecordedEvents;
use diffloupe_core::testutil::test_env;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

struct Server {
    url: String,
    hits: Arc<AtomicUsize>,
}

fn serve(status: &'static str, body: String) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!(
        "http://{}/repos/brisote/diff-loupe/releases/latest",
        listener.local_addr().unwrap()
    );
    let hits = Arc::new(AtomicUsize::new(0));
    let counted = hits.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            counted.fetch_add(1, Ordering::SeqCst);
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
        }
    });
    Server { url, hits }
}

fn release(tag: &str) -> String {
    json!({
        "tag_name": tag,
        "html_url": format!("https://github.com/brisote/diff-loupe/releases/tag/{tag}"),
    })
    .to_string()
}

fn core(url: &str) -> (tempfile::TempDir, Core) {
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(RecordedEvents::default())).unwrap();
    core.set_update_url(url);
    (data, core)
}

fn check(url: &str) -> Result<Value, Value> {
    let (_data, core) = core(url);
    core.dispatch("check_update", Value::Null)
        .map_err(|error| json!(error))
}

fn silent() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/latest", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        let held: Vec<_> = listener.incoming().take(1).collect();
        std::thread::sleep(std::time::Duration::from_secs(10));
        drop(held);
    });
    url
}

#[test]
fn a_newer_release_is_offered() {
    let server = serve("200 OK", release("v99.0.0"));
    let check = check(&server.url).unwrap();
    assert_eq!(check["latest"], "99.0.0");
    assert_eq!(check["current"], env!("CARGO_PKG_VERSION"));
    assert_eq!(check["newer"], true);
    assert_eq!(
        check["page"],
        "https://github.com/brisote/diff-loupe/releases/tag/v99.0.0"
    );
    assert_eq!(server.hits.load(Ordering::SeqCst), 1);
}

#[test]
fn the_same_or_an_older_release_is_not_offered() {
    let same = serve(
        "200 OK",
        release(&format!("v{}", env!("CARGO_PKG_VERSION"))),
    );
    assert_eq!(check(&same.url).unwrap()["newer"], false);
    let older = serve("200 OK", release("v0.0.1"));
    assert_eq!(check(&older.url).unwrap()["newer"], false);
}

#[test]
fn a_server_error_says_to_try_again_later() {
    let server = serve("503 Service Unavailable", "{}".to_string());
    let error = check(&server.url).unwrap_err();
    assert_eq!(error["code"], "update");
    assert_eq!(
        error["message"],
        "GitHub did not return the latest release. Try again later."
    );
}

#[test]
fn a_missing_release_says_github_returned_none() {
    let server = serve(
        "404 Not Found",
        json!({ "message": "Not Found" }).to_string(),
    );
    let error = check(&server.url).unwrap_err();
    assert_eq!(error["code"], "update");
    assert_eq!(
        error["message"],
        "GitHub did not return the latest release. Try again later."
    );
}

#[test]
fn a_server_that_does_not_answer_times_out() {
    let (_data, core) = core(&silent());
    core.set_update_max_time(1);
    let started = std::time::Instant::now();
    let error = json!(core.dispatch("check_update", Value::Null).unwrap_err());
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert_eq!(
        error["message"],
        "GitHub could not be reached. Check the connection and try again."
    );
}

#[test]
fn a_closed_port_says_github_could_not_be_reached() {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let error = check(&format!("http://127.0.0.1:{port}/latest")).unwrap_err();
    assert_eq!(error["code"], "update");
}

#[test]
fn an_answer_that_is_not_a_release_is_refused() {
    let server = serve("200 OK", json!({ "message": "Not Found" }).to_string());
    let error = check(&server.url).unwrap_err();
    assert_eq!(error["code"], "update");
    assert_eq!(
        error["message"],
        "GitHub answered with a release that Diffloupe cannot read."
    );
}

#[test]
fn the_setting_is_on_by_default_and_kept_when_saved() {
    let (_data, core) = core("http://127.0.0.1:9/latest");
    let settings = core.dispatch("get_settings", Value::Null).unwrap();
    assert_eq!(settings["updates"]["check"], true);
    let mut off = settings.clone();
    off["updates"]["check"] = json!(false);
    let saved = core
        .dispatch("set_settings", json!({ "settings": off }))
        .unwrap();
    assert_eq!(saved["updates"]["check"], false);
}

type Files = Arc<Mutex<HashMap<String, (&'static str, Vec<u8>)>>>;

fn serve_files() -> (String, Files) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let files: Files = Arc::default();
    let served = files.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut request = [0u8; 4096];
            let read = stream.read(&mut request).unwrap_or(0);
            let line = String::from_utf8_lossy(&request[..read]).to_string();
            let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
            let (status, body) = served
                .lock()
                .unwrap()
                .get(&path)
                .cloned()
                .unwrap_or(("404 Not Found", Vec::new()));
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    (base, files)
}

fn hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn newer_release(image: Option<&[u8]>, checksum: &str) -> String {
    newer_release_sized(image, checksum, image.map_or(0, <[u8]>::len))
}

fn newer_release_sized(image: Option<&[u8]>, checksum: &str, size: usize) -> String {
    let (base, files) = serve_files();
    let mut files = files.lock().unwrap();
    let mut assets = vec![json!({
        "name": "Diffloupe-99.0.0.dmg.sha256",
        "size": 90,
        "browser_download_url": format!("{base}/download/Diffloupe-99.0.0.dmg.sha256"),
    })];
    files.insert(
        "/download/Diffloupe-99.0.0.dmg.sha256".to_string(),
        (
            "200 OK",
            format!("{checksum}  Diffloupe-99.0.0.dmg\n").into_bytes(),
        ),
    );
    if let Some(image) = image {
        assets.push(json!({
            "name": "Diffloupe-99.0.0.dmg",
            "size": size,
            "browser_download_url": format!("{base}/download/Diffloupe-99.0.0.dmg"),
        }));
        files.insert(
            "/download/Diffloupe-99.0.0.dmg".to_string(),
            ("200 OK", image.to_vec()),
        );
    }
    let body = json!({
        "tag_name": "v99.0.0",
        "html_url": "https://github.com/brisote/diff-loupe/releases/tag/v99.0.0",
        "assets": assets,
    });
    files.insert(
        "/latest".to_string(),
        ("200 OK", body.to_string().into_bytes()),
    );
    format!("{base}/latest")
}

fn downloaded(
    url: &str,
) -> (
    tempfile::TempDir,
    Core,
    Arc<RecordedEvents>,
    Result<Value, Value>,
) {
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    core.set_update_url(url);
    core.dispatch("check_update", Value::Null).unwrap();
    let result = core
        .dispatch("download_update", json!({ "version": "99.0.0" }))
        .map_err(|error| json!(error));
    (data, core, events, result)
}

#[test]
fn a_verified_download_is_ready_to_install() {
    let image = vec![7u8; 300_000];
    let (data, core, events, result) = downloaded(&newer_release(Some(&image), &hex(&image)));
    assert_eq!(result.unwrap(), json!({ "version": "99.0.0" }));
    let ready = core.update_ready().unwrap();
    assert_eq!(ready, data.path().join("updates/Diffloupe-99.0.0.dmg"));
    assert_eq!(std::fs::read(&ready).unwrap(), image);
    let labels: Vec<_> = events
        .take()
        .into_iter()
        .filter_map(|event| match json!(event) {
            Value::Object(event) if event["type"] == "task" => Some(event["label"].clone()),
            _ => None,
        })
        .collect();
    assert!(
        labels.contains(&json!("Downloading Diffloupe 99.0.0")),
        "{labels:?}"
    );
}

#[test]
fn a_download_that_does_not_match_its_checksum_is_deleted() {
    let image = vec![7u8; 1000];
    let (data, core, _events, result) = downloaded(&newer_release(Some(&image), &hex(b"other")));
    let error = result.unwrap_err();
    assert_eq!(error["code"], "update");
    assert_eq!(
        error["message"],
        format!(
            "Diffloupe 99.0.0 was not installed because its download does not match the checksum, and {} is unchanged.",
            env!("CARGO_PKG_VERSION")
        )
    );
    assert!(core.update_ready().is_none());
    assert!(!data.path().join("updates").exists());
}

#[test]
fn a_release_without_a_disk_image_cannot_be_downloaded() {
    let (_data, core, _events, result) = downloaded(&newer_release(None, &hex(b"x")));
    assert!(
        result.unwrap_err()["message"]
            .as_str()
            .unwrap()
            .contains("because its release has no disk image")
    );
    assert!(core.update_ready().is_none());
}

#[test]
fn a_download_needs_a_newer_release_first() {
    let (_data, core) = core("http://127.0.0.1:9/latest");
    let error = json!(
        core.dispatch("download_update", json!({ "version": "99.0.0" }))
            .unwrap_err()
    );
    assert_eq!(error["code"], "invalidArgs");
}

#[test]
fn a_download_of_another_version_is_refused() {
    let image = vec![7u8; 1000];
    let (_data, core) = core(&newer_release(Some(&image), &hex(&image)));
    core.dispatch("check_update", Value::Null).unwrap();
    let error = json!(
        core.dispatch("download_update", json!({ "version": "98.0.0" }))
            .unwrap_err()
    );
    assert_eq!(error["code"], "invalidArgs");
    assert!(core.update_ready().is_none());
}

#[test]
fn a_download_of_another_size_is_deleted() {
    let image = vec![7u8; 1000];
    let (data, core, _events, result) =
        downloaded(&newer_release_sized(Some(&image), &hex(&image), 2000));
    assert!(
        result.unwrap_err()["message"]
            .as_str()
            .unwrap()
            .contains("because its download is not the size the release gives")
    );
    assert!(core.update_ready().is_none());
    assert!(!data.path().join("updates").exists());
}

#[test]
fn a_download_larger_than_the_release_says_is_stopped() {
    let image = vec![7u8; 5000];
    let (data, _core, _events, result) =
        downloaded(&newer_release_sized(Some(&image), &hex(&image), 1000));
    assert!(
        result.unwrap_err()["message"]
            .as_str()
            .unwrap()
            .contains("because the download stopped")
    );
    assert!(!data.path().join("updates").exists());
}

#[test]
fn a_ready_update_is_still_ready_after_a_restart() {
    let image = vec![7u8; 1000];
    let (data, core, _events, result) = downloaded(&newer_release(Some(&image), &hex(&image)));
    result.unwrap();
    drop(core);
    let again = Core::new(data.path(), test_env(), Arc::new(RecordedEvents::default())).unwrap();
    let state = again.dispatch("update_state", Value::Null).unwrap();
    assert_eq!(state["ready"], "99.0.0");
    assert_eq!(
        state["page"],
        "https://github.com/brisote/diff-loupe/releases/tag/v99.0.0"
    );
    assert_eq!(
        again.update_ready(),
        Some(data.path().join("updates/Diffloupe-99.0.0.dmg"))
    );
}

#[test]
fn a_failed_install_is_reported_after_the_restart_until_dismissed() {
    let data = tempfile::tempdir().unwrap();
    let updates = data.path().join("updates");
    std::fs::create_dir_all(&updates).unwrap();
    std::fs::write(
        updates.join("failed"),
        "Diffloupe 99.0.0 was not installed.",
    )
    .unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(RecordedEvents::default())).unwrap();
    let state = core.dispatch("update_state", Value::Null).unwrap();
    assert_eq!(state["failure"], "Diffloupe 99.0.0 was not installed.");
    assert_eq!(state["ready"], Value::Null);
    core.dispatch("dismiss_update", Value::Null).unwrap();
    assert_eq!(
        core.dispatch("update_state", Value::Null).unwrap()["failure"],
        Value::Null
    );
    assert!(!updates.exists());
}
