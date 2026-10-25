#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::RecordedEvents;
use diffloupe_core::platform::Platform;
use diffloupe_core::testutil::test_env;
use diffloupe_core::update::{PackageKind, package_name};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

fn for_this_system(data: &std::path::Path) -> Core {
    Core::for_platform(
        data,
        test_env(),
        Arc::new(RecordedEvents::default()),
        Platform::CURRENT,
    )
    .unwrap()
}

fn package() -> String {
    package_name(
        "99.0.0",
        PackageKind::of(Platform::CURRENT, "x86_64", Some(PackageKind::Deb)).unwrap(),
    )
}

fn latest_path() -> String {
    format!("/download/latest/{}/version", Platform::CURRENT.name())
}

struct Server {
    url: String,
    hits: Arc<AtomicUsize>,
}

fn serve(status: &'static str, body: String) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}{}", listener.local_addr().unwrap(), latest_path());
    let hits = Arc::new(AtomicUsize::new(0));
    let counted = hits.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            counted.fetch_add(1, Ordering::SeqCst);
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
        }
    });
    Server { url, hits }
}

fn release(version: &str) -> String {
    format!("{version}\n")
}

fn core(url: &str) -> (tempfile::TempDir, Core) {
    let data = tempfile::tempdir().unwrap();
    let core = for_this_system(data.path());
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
fn a_newer_version_is_offered_with_its_release_page() {
    let server = serve("200 OK", release("99.0.0"));
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
    let same = serve("200 OK", release(env!("CARGO_PKG_VERSION")));
    assert_eq!(check(&same.url).unwrap()["newer"], false);
    let older = serve("200 OK", release("0.0.1"));
    assert_eq!(check(&older.url).unwrap()["newer"], false);
}

#[test]
fn a_server_error_says_to_try_again_later() {
    let server = serve("503 Service Unavailable", "{}".to_string());
    let error = check(&server.url).unwrap_err();
    assert_eq!(error["code"], "update");
    assert_eq!(
        error["message"],
        "diffloupe.com did not return the latest version. Try again later."
    );
}

#[test]
fn a_missing_version_file_says_none_was_returned() {
    let server = serve("404 Not Found", "Not Found".to_string());
    let error = check(&server.url).unwrap_err();
    assert_eq!(error["code"], "update");
    assert_eq!(
        error["message"],
        "diffloupe.com did not return the latest version. Try again later."
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
        "diffloupe.com could not be reached. Check the connection and try again."
    );
}

#[test]
fn a_closed_port_says_the_site_could_not_be_reached() {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let error = check(&format!("http://127.0.0.1:{port}/latest")).unwrap_err();
    assert_eq!(error["code"], "update");
}

#[test]
fn an_answer_that_is_not_a_version_is_refused() {
    for body in ["<html>Moved</html>", "v99.0.0", "99.0"] {
        let server = serve("200 OK", body.to_string());
        let error = check(&server.url).unwrap_err();
        assert_eq!(error["code"], "update");
        assert_eq!(
            error["message"],
            "diffloupe.com answered with a version that Diffloupe cannot read."
        );
    }
}

#[test]
fn a_long_answer_is_refused_without_reading_it() {
    let server = serve("200 OK", "9".repeat(5000));
    let error = check(&server.url).unwrap_err();
    assert_eq!(error["code"], "update");
    assert_eq!(
        error["message"],
        "diffloupe.com answered with a version that Diffloupe cannot read."
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

type Files = Arc<Mutex<HashMap<String, (&'static str, Vec<u8>, Option<usize>)>>>;

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
            let mut words = line.split_whitespace();
            let method = words.next().unwrap_or("GET").to_string();
            let path = words.next().unwrap_or("/").to_string();
            let (status, body, announced) = served.lock().unwrap().get(&path).cloned().unwrap_or((
                "404 Not Found",
                Vec::new(),
                None,
            ));
            let length = if method == "HEAD" {
                announced.unwrap_or(body.len())
            } else {
                body.len()
            };
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
            );
            let _ = stream.write_all(head.as_bytes());
            if method != "HEAD" {
                let _ = stream.write_all(&body);
            }
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
    newer_release_sized(image, checksum, None)
}

fn newer_release_sized(image: Option<&[u8]>, checksum: &str, announced: Option<usize>) -> String {
    let (base, files) = serve_files();
    let mut files = files.lock().unwrap();
    files.insert(
        format!("/download/v99.0.0/{}.sha256", package()),
        (
            "200 OK",
            format!("{checksum}  {}\n", package()).into_bytes(),
            None,
        ),
    );
    if let Some(image) = image {
        files.insert(
            format!("/download/v99.0.0/{}", package()),
            ("200 OK", image.to_vec(), announced),
        );
    }
    files.insert(latest_path(), ("200 OK", b"99.0.0\n".to_vec(), None));
    format!("{base}{}", latest_path())
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
    let core =
        Core::for_platform(data.path(), test_env(), events.clone(), Platform::CURRENT).unwrap();
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
    assert_eq!(ready, data.path().join("updates").join(package()));
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
            .contains("because its release has no package for this system")
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
fn a_download_larger_than_the_server_announced_is_stopped() {
    let image = vec![7u8; 5000];
    let (data, _core, _events, result) =
        downloaded(&newer_release_sized(Some(&image), &hex(&image), Some(1000)));
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
    let again = for_this_system(data.path());
    let state = again.dispatch("update_state", Value::Null).unwrap();
    assert_eq!(state["ready"], "99.0.0");
    assert_eq!(
        state["page"],
        "https://github.com/brisote/diff-loupe/releases/tag/v99.0.0"
    );
    assert_eq!(
        again.update_ready(),
        Some(data.path().join("updates").join(package()))
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
    let core = for_this_system(data.path());
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

#[test]
fn every_platform_downloads_its_own_package_and_ignores_the_others() {
    let image = vec![5u8; 50_000];
    let cases = [
        (Platform::Macos, "Diffloupe-99.0.0.dmg"),
        (Platform::Windows, "Diffloupe-99.0.0-windows-x64-setup.exe"),
        (Platform::Linux, "Diffloupe-99.0.0-linux-amd64.deb"),
    ];
    for (platform, name) in cases {
        let (base, files) = serve_files();
        {
            let mut files = files.lock().unwrap();
            files.insert(
                format!("/download/v99.0.0/{name}.sha256"),
                (
                    "200 OK",
                    format!("{}  {name}\n", hex(&image)).into_bytes(),
                    None,
                ),
            );
            files.insert(
                format!("/download/v99.0.0/{name}"),
                ("200 OK", image.clone(), None),
            );
            files.insert(
                format!("/download/latest/{}/version", platform.name()),
                ("200 OK", b"99.0.0\n".to_vec(), None),
            );
        }
        let data = tempfile::tempdir().unwrap();
        let core = Core::for_platform(
            data.path(),
            test_env(),
            Arc::new(RecordedEvents::default()),
            platform,
        )
        .unwrap();
        core.set_update_url(&format!(
            "{base}/download/latest/{}/version",
            platform.name()
        ));
        let check = core.dispatch("check_update", Value::Null).unwrap();
        assert_eq!(check["latest"], "99.0.0", "{platform:?}");
        core.dispatch("download_update", json!({ "version": "99.0.0" }))
            .unwrap_or_else(|error| panic!("{platform:?}: {}", error.message));
        assert_eq!(
            core.update_ready().unwrap(),
            data.path().join("updates").join(name),
            "{platform:?}"
        );
        drop(core);
        let again = Core::for_platform(
            data.path(),
            test_env(),
            Arc::new(RecordedEvents::default()),
            platform,
        )
        .unwrap();
        assert!(
            again.update_ready().is_some(),
            "{platform:?} keeps it after a restart"
        );
        drop(again);
        let other = Core::for_platform(
            data.path(),
            test_env(),
            Arc::new(RecordedEvents::default()),
            if platform == Platform::Windows {
                Platform::Linux
            } else {
                Platform::Windows
            },
        )
        .unwrap();
        assert!(
            other.update_ready().is_none(),
            "{platform:?} package is not another's"
        );
    }
}
