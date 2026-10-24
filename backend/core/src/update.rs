use std::fs;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::events::Task;
use crate::gitops::{self, Watch};
use crate::shellenv::ShellEnv;

pub const LATEST: &str = "https://api.github.com/repos/brisote/diff-loupe/releases/latest";
pub const REPOSITORY: &str = "https://github.com/brisote/diff-loupe";
pub const RELEASES: &str = "https://github.com/brisote/diff-loupe/releases/";
pub const MAX_TIME: u64 = 20;
const DOWNLOAD_TIME: u64 = 1800;
const UNREACHABLE: &str = "GitHub could not be reached. Check the connection and try again.";
const NO_RELEASE: &str = "GitHub did not return the latest release. Try again later.";
const CURL_HTTP_ERROR: i32 = 22;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateCheck {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    pub page: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub check: UpdateCheck,
    pub image: Option<Asset>,
    pub checksum: Option<Asset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateReady {
    pub version: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateState {
    pub ready: Option<String>,
    pub failure: Option<String>,
    pub page: Option<String>,
}

pub fn repository_page(url: &str) -> bool {
    url.strip_prefix(REPOSITORY).is_some_and(|rest| {
        (rest.is_empty() || rest.starts_with('/') || rest.starts_with('#'))
            && !rest.contains("/.")
            && !rest.contains('%')
            && !rest.contains('\\')
    })
}

pub fn link(url: &str) -> Result<&str> {
    if repository_page(url) {
        Ok(url)
    } else {
        Err(Error::InvalidArgs(format!(
            "{url} is not a page of Diffloupe's repository"
        )))
    }
}

pub fn source() -> String {
    source_from(std::env::var("DIFFLOUPE_UPDATE_URL").ok())
}

pub fn source_from(value: Option<String>) -> String {
    value
        .filter(|url| loopback(url))
        .unwrap_or_else(|| LATEST.to_string())
}

fn loopback(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or_default();
    let host = if host.starts_with("[::1]") {
        "[::1]"
    } else {
        host.split(':').next().unwrap_or_default()
    };
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Pending {
    pub ready: Option<(String, PathBuf)>,
    pub failure: Option<String>,
}

pub const FAILED: &str = "failed";

pub fn pending(dir: &Path, current: &str) -> Pending {
    let failure = fs::read_to_string(dir.join(FAILED))
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    let ready = failure.is_none().then(|| {
        fs::read_dir(dir).ok()?.flatten().find_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let version = name.strip_prefix("Diffloupe-")?.strip_suffix(".dmg")?;
            newer(version, current).then(|| (version.to_string(), entry.path()))
        })
    });
    let ready = ready.flatten();
    if ready.is_none() {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_name() != FAILED {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        if failure.is_none() {
            let _ = fs::remove_dir_all(dir);
        }
    }
    Pending { ready, failure }
}

pub fn check(env: &ShellEnv, url: &str, max_time: u64, current: &str) -> Result<Release> {
    let max_time = max_time.to_string();
    let output = env
        .curl()
        .args([
            "-q",
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--max-time",
            &max_time,
            "--header",
            "Accept: application/vnd.github+json",
            url,
        ])
        .output()
        .map_err(|_| Error::Update(UNREACHABLE.to_string()))?;
    match output.status.code() {
        Some(0) => {}
        Some(CURL_HTTP_ERROR) => return Err(Error::Update(NO_RELEASE.to_string())),
        _ => return Err(Error::Update(UNREACHABLE.to_string())),
    }
    parse(&output.stdout, current, &downloads(url))
}

pub fn downloads(source: &str) -> String {
    if source == LATEST {
        return format!("{RELEASES}download/");
    }
    let rest = source.split_once("://").map_or("", |(_, rest)| rest);
    let host = rest.split('/').next().unwrap_or_default();
    let scheme = source.split("://").next().unwrap_or_default();
    format!("{scheme}://{host}/")
}

pub fn parse(body: &[u8], current: &str, downloads: &str) -> Result<Release> {
    let invalid =
        || Error::Update("GitHub answered with a release that Diffloupe cannot read.".to_string());
    let release: Value = serde_json::from_slice(body).map_err(|_| invalid())?;
    let latest = release
        .get("tag_name")
        .and_then(Value::as_str)
        .and_then(|tag| tag.strip_prefix('v'))
        .filter(|version| parts(version).is_some())
        .ok_or_else(invalid)?;
    let page = release
        .get("html_url")
        .and_then(Value::as_str)
        .filter(|page| page.starts_with(RELEASES) && repository_page(page))
        .ok_or_else(invalid)?;
    let asset = |name: String| {
        release
            .get("assets")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|asset| asset.get("name").and_then(Value::as_str) == Some(name.as_str()))
            .and_then(|asset| {
                let url = asset.get("browser_download_url").and_then(Value::as_str)?;
                let size = asset.get("size").and_then(Value::as_u64)?;
                (url.starts_with(downloads) && !url.contains("/.") && !url.contains('%')).then(
                    || Asset {
                        url: url.to_string(),
                        size,
                    },
                )
            })
    };
    Ok(Release {
        check: UpdateCheck {
            current: current.to_string(),
            latest: latest.to_string(),
            newer: newer(latest, current),
            page: page.to_string(),
        },
        image: asset(format!("Diffloupe-{latest}.dmg")),
        checksum: asset(format!("Diffloupe-{latest}.dmg.sha256")),
    })
}

pub fn download(
    env: &ShellEnv,
    release: &Release,
    dir: &Path,
    watch: &Watch<'_>,
    task: &mut Task<'_>,
) -> Result<PathBuf> {
    let UpdateCheck {
        latest, current, ..
    } = &release.check;
    let not_installed = |why: &str| {
        Error::Update(format!(
            "Diffloupe {latest} was not installed because {why}, and {current} is unchanged."
        ))
    };
    let (Some(image), Some(checksum)) = (&release.image, &release.checksum) else {
        return Err(not_installed("its release has no disk image"));
    };
    let _ = fs::remove_dir_all(dir);
    let target = dir.join(format!("Diffloupe-{latest}.dmg"));
    let part = dir.join(format!("Diffloupe-{latest}.dmg.part"));
    let verified = fs::create_dir_all(dir)
        .map_err(Error::from)
        .and_then(|()| fetch(env, &image.url, &part, image.size, watch, task, latest))
        .and_then(|()| {
            task.uncancellable();
            if fs::metadata(&part)?.len() != image.size {
                return Err(not_installed(
                    "its download is not the size the release gives",
                ));
            }
            let expected = expected_digest(env, &checksum.url)
                .ok_or_else(|| not_installed("its checksum could not be read"))?;
            if digest(&part)? != expected {
                return Err(not_installed("its download does not match the checksum"));
            }
            Ok(fs::rename(&part, &target)?)
        });
    match verified {
        Ok(()) => Ok(target),
        Err(error) => {
            let _ = fs::remove_dir_all(dir);
            Err(match error {
                Error::Cancelled | Error::Update(_) => error,
                _ => not_installed("the download stopped"),
            })
        }
    }
}

fn fetch(
    env: &ShellEnv,
    url: &str,
    part: &Path,
    size: u64,
    watch: &Watch<'_>,
    task: &mut Task<'_>,
    latest: &str,
) -> Result<()> {
    let mut child = env
        .curl()
        .args(["-q", "--fail", "--silent", "--location"])
        .args(protocols(url))
        .arg("--max-time")
        .arg(DOWNLOAD_TIME.to_string())
        .arg("--max-filesize")
        .arg(size.to_string())
        .arg("--output")
        .arg(part)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()?;
    let label = format!("Downloading Diffloupe {latest}");
    let mut shown = None;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if watch.cancelled() {
            gitops::stop(&mut child);
            return Err(Error::Cancelled);
        }
        let received = fs::metadata(part).map_or(0, |meta| meta.len());
        let percent = received
            .saturating_mul(100)
            .checked_div(size)
            .map(|p| p.min(100));
        if percent.is_some() && percent != shown {
            shown = percent;
            task.progress(label.clone(), percent.unwrap_or(0) as f64 / 100.0);
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    if status.success() {
        Ok(())
    } else {
        Err(Error::Io(std::io::Error::other("the download stopped")))
    }
}

fn expected_digest(env: &ShellEnv, url: &str) -> Option<String> {
    let output = env
        .curl()
        .args(["-q", "--fail", "--silent", "--location"])
        .args(protocols(url))
        .args(["--max-filesize", "4096", "--max-time"])
        .arg(MAX_TIME.to_string())
        .arg(url)
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let digest = text.split_whitespace().next()?.to_ascii_lowercase();
    (output.status.success() && digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit()))
        .then_some(digest)
}

fn protocols(url: &str) -> &'static [&'static str] {
    if url.starts_with("https://") {
        &["--proto", "=https", "--proto-redir", "=https"]
    } else {
        &[]
    }
}

fn digest(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

pub fn newer(candidate: &str, current: &str) -> bool {
    match (parts(candidate), parts(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
    }
}

fn parts(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.split('.').map(|part| part.parse::<u64>().ok());
    let found = [parts.next()??, parts.next()??, parts.next()??];
    parts.next().is_none().then_some(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GITHUB: &str = "https://github.com/brisote/diff-loupe/releases/download/";

    fn release(tag: &str, page: &str) -> Vec<u8> {
        serde_json::json!({ "tag_name": tag, "html_url": page })
            .to_string()
            .into_bytes()
    }

    #[test]
    fn opens_only_pages_of_the_repository() {
        assert!(repository_page("https://github.com/brisote/diff-loupe"));
        assert!(repository_page(
            "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0"
        ));
        assert!(!repository_page(
            "https://github.com/brisote/diff-loupe.evil.com"
        ));
        assert!(!repository_page(
            "https://github.com/brisote/diff-loupe-fork"
        ));
        assert!(!repository_page("https://example.com/brisote/diff-loupe"));
        assert!(!repository_page(
            "https://github.com/brisote/diff-loupe/../../attacker/repo"
        ));
        assert!(!repository_page(
            "https://github.com/brisote/diff-loupe/%2e%2e/attacker"
        ));
        assert!(link("https://github.com/brisote/diff-loupe#readme").is_ok());
        assert!(link("https://github.com/brisote/diff-loupe-fork").is_err());
    }

    #[test]
    fn compares_versions_by_number() {
        assert!(newer("0.10.0", "0.9.9"));
        assert!(newer("1.0.0", "0.99.0"));
        assert!(!newer("0.2.0", "0.2.0"));
        assert!(!newer("0.1.9", "0.2.0"));
        assert!(!newer("0.3", "0.2.0"));
        assert!(!newer("0.3.0-beta", "0.2.0"));
    }

    #[test]
    fn reads_the_latest_release() {
        let page = "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0";
        let check = parse(&release("v0.3.0", page), "0.2.0", GITHUB)
            .unwrap()
            .check;
        assert_eq!(
            check,
            UpdateCheck {
                current: "0.2.0".to_string(),
                latest: "0.3.0".to_string(),
                newer: true,
                page: page.to_string(),
            }
        );
    }

    #[test]
    fn refuses_a_release_it_cannot_trust() {
        let page = "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0";
        assert!(parse(b"not json", "0.2.0", GITHUB).is_err());
        assert!(parse(&release("0.3.0", page), "0.2.0", GITHUB).is_err());
        assert!(parse(&release("vnext", page), "0.2.0", GITHUB).is_err());
        assert!(
            parse(
                &release("v0.3.0", "https://example.com/v0.3.0"),
                "0.2.0",
                GITHUB
            )
            .is_err()
        );
        assert!(
            parse(
                &release(
                    "v0.3.0",
                    "https://github.com/brisote/diff-loupe/releases/../../../x"
                ),
                "0.2.0",
                GITHUB
            )
            .is_err()
        );
    }

    #[test]
    fn reads_the_disk_image_and_its_checksum_from_the_release() {
        let base = "https://github.com/brisote/diff-loupe/releases/download/v0.3.0";
        let body = serde_json::json!({
            "tag_name": "v0.3.0",
            "html_url": "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0",
            "assets": [
                { "name": "Diffloupe-0.3.0.dmg", "size": 42, "browser_download_url": format!("{base}/Diffloupe-0.3.0.dmg") },
                { "name": "Diffloupe-0.3.0.dmg.sha256", "size": 90, "browser_download_url": format!("{base}/Diffloupe-0.3.0.dmg.sha256") },
                { "name": "notes.txt", "size": 1, "browser_download_url": format!("{base}/notes.txt") }
            ]
        });
        let release = parse(body.to_string().as_bytes(), "0.2.0", GITHUB).unwrap();
        assert_eq!(
            release.image,
            Some(Asset {
                url: format!("{base}/Diffloupe-0.3.0.dmg"),
                size: 42
            })
        );
        assert_eq!(
            release.checksum.map(|asset| asset.url),
            Some(format!("{base}/Diffloupe-0.3.0.dmg.sha256"))
        );
    }

    #[test]
    fn ignores_disk_images_from_other_places() {
        let body = serde_json::json!({
            "tag_name": "v0.3.0",
            "html_url": "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0",
            "assets": [
                { "name": "Diffloupe-0.3.0.dmg", "size": 42, "browser_download_url": "https://example.com/Diffloupe-0.3.0.dmg" },
                { "name": "Diffloupe-0.3.0.dmg.sha256", "size": 90, "browser_download_url": "https://github.com/brisote/diff-loupe/releases/download/../../x" }
            ]
        });
        let release = parse(body.to_string().as_bytes(), "0.2.0", GITHUB).unwrap();
        assert_eq!(release.image, None);
        assert_eq!(release.checksum, None);
    }

    #[test]
    fn downloads_come_from_github_or_the_test_server() {
        assert_eq!(downloads(LATEST), GITHUB);
        assert_eq!(
            downloads("http://127.0.0.1:4100/repos/brisote/diff-loupe/releases/latest"),
            "http://127.0.0.1:4100/"
        );
    }

    #[test]
    fn only_a_local_address_replaces_github() {
        assert_eq!(source_from(None), LATEST);
        for local in [
            "http://127.0.0.1:9/latest",
            "http://localhost:4100/latest",
            "http://[::1]:4100/latest",
        ] {
            assert_eq!(source_from(Some(local.to_string())), local);
        }
        for remote in [
            "http://example.com/latest",
            "https://127.0.0.1/latest",
            "http://127.0.0.1.example.com/latest",
        ] {
            assert_eq!(source_from(Some(remote.to_string())), LATEST, "{remote}");
        }
    }

    #[test]
    fn a_verified_download_waits_and_older_ones_are_cleared() {
        let dir = tempfile::tempdir().unwrap();
        let updates = dir.path().join("updates");
        fs::create_dir_all(&updates).unwrap();
        fs::write(updates.join("Diffloupe-0.3.0.dmg"), b"image").unwrap();
        let found = pending(&updates, "0.2.0");
        assert_eq!(
            found.ready,
            Some(("0.3.0".to_string(), updates.join("Diffloupe-0.3.0.dmg")))
        );
        assert_eq!(pending(&updates, "0.3.0"), Pending::default());
        assert!(!updates.exists());
    }

    #[test]
    fn a_failed_install_is_reported_once_the_app_starts_again() {
        let dir = tempfile::tempdir().unwrap();
        let updates = dir.path().join("updates");
        fs::create_dir_all(&updates).unwrap();
        fs::write(updates.join("Diffloupe-0.3.0.dmg"), b"image").unwrap();
        fs::write(updates.join(FAILED), "Diffloupe 0.3.0 was not installed.\n").unwrap();
        let found = pending(&updates, "0.2.0");
        assert_eq!(found.ready, None);
        assert_eq!(
            found.failure.as_deref(),
            Some("Diffloupe 0.3.0 was not installed.")
        );
        assert!(!updates.join("Diffloupe-0.3.0.dmg").exists());
    }
}
