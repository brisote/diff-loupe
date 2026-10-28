use std::ffi::OsStr;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub type Target = PathBuf;

const STEP_TIME: Duration = Duration::from_secs(120);
const REQUIREMENT: &str = "=identifier \"com.diffloupe.app\"";

pub fn version(image: &Path) -> String {
    image
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("Diffloupe-"))
        .and_then(|name| name.strip_suffix(".dmg"))
        .unwrap_or("the new version")
        .to_string()
}

pub fn not_installed(image: &Path, why: &str) -> String {
    format!(
        "Diffloupe {} was not installed because {why}, and {} is unchanged.",
        version(image),
        env!("CARGO_PKG_VERSION")
    )
}

fn quiet(program: &str, args: &[&OsStr]) -> bool {
    let Ok(mut child) = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if started.elapsed() < STEP_TIME => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn sibling(bundle: &Path, suffix: &str) -> PathBuf {
    let name = bundle
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Diffloupe.app");
    bundle.with_file_name(format!(".{name}.{suffix}"))
}

pub fn leftovers(bundle: &Path) -> Vec<PathBuf> {
    vec![sibling(bundle, "new"), sibling(bundle, "old")]
}

pub fn clear_leftovers(bundle: &Path) {
    if bundle.is_dir() {
        for leftover in leftovers(bundle) {
            let _ = std::fs::remove_dir_all(leftover);
        }
    }
}

pub fn stage(image: &Path, bundle: &Path) -> Result<PathBuf, String> {
    let mount = std::env::temp_dir().join(format!("diffloupe-update-{}", std::process::id()));
    std::fs::create_dir_all(&mount)
        .map_err(|_| not_installed(image, "its disk image cannot be opened"))?;
    let attached = quiet(
        "/usr/bin/hdiutil",
        &[
            "attach".as_ref(),
            image.as_os_str(),
            "-readonly".as_ref(),
            "-nobrowse".as_ref(),
            "-noautoopen".as_ref(),
            "-mountpoint".as_ref(),
            mount.as_os_str(),
            "-quiet".as_ref(),
        ],
    );
    if !attached {
        let _ = std::fs::remove_dir(&mount);
        return Err(not_installed(image, "its disk image cannot be opened"));
    }
    let staged = copy_out(image, &mount.join("Diffloupe.app"), bundle);
    quiet(
        "/usr/bin/hdiutil",
        &[
            "detach".as_ref(),
            mount.as_os_str(),
            "-quiet".as_ref(),
            "-force".as_ref(),
        ],
    );
    let _ = std::fs::remove_dir(&mount);
    staged
}

fn copy_out(image: &Path, app: &Path, bundle: &Path) -> Result<PathBuf, String> {
    if !app.is_dir() {
        return Err(not_installed(image, "its disk image has no Diffloupe app"));
    }
    let verified = quiet(
        "/usr/bin/codesign",
        &[
            "--verify".as_ref(),
            "--deep".as_ref(),
            "--strict".as_ref(),
            "-R".as_ref(),
            REQUIREMENT.as_ref(),
            app.as_os_str(),
        ],
    );
    if !verified {
        return Err(not_installed(
            image,
            "the new app's signature does not verify",
        ));
    }
    let staged = sibling(bundle, "new");
    let _ = std::fs::remove_dir_all(&staged);
    if !quiet("/usr/bin/ditto", &[app.as_os_str(), staged.as_os_str()]) {
        let _ = std::fs::remove_dir_all(&staged);
        return Err(not_installed(
            image,
            "the new app cannot be copied next to the installed one",
        ));
    }
    quiet(
        "/usr/bin/xattr",
        &[
            "-dr".as_ref(),
            "com.apple.quarantine".as_ref(),
            staged.as_os_str(),
        ],
    );
    Ok(staged)
}

pub fn swap_after_exit(
    image: &Path,
    bundle: &Path,
    staged: &Path,
    reopen: bool,
) -> Result<(), String> {
    let downloads = image.parent().unwrap_or(image);
    let carried = std::env::vars()
        .filter(|(name, _)| name == "HOME" || name.starts_with("DIFFLOUPE_"))
        .flat_map(|(name, value)| ["--env".to_string(), format!("{name}={value}")]);
    Command::new("/bin/sh")
        .arg("-c")
        .arg(
            r#"pid=$1; bundle=$2; staged=$3; old=$4; downloads=$5; failure=$6; reopen=$7; shift 7
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
failed() { rm -rf -- "$staged"; mkdir -p -- "$downloads" && printf '%s\n' "$failure" > "$downloads/failed"; }
rm -rf -- "$old"
if [ -e "$old" ]; then failed
elif ! mv -- "$bundle" "$old"; then failed
elif ! mv -- "$staged" "$bundle"; then mv -- "$old" "$bundle"; failed
else rm -rf -- "$old" "$downloads"; /usr/bin/mdimport "$bundle" >/dev/null 2>&1 &
fi
[ "$reopen" = 1 ] && [ -d "$bundle" ] && /usr/bin/open -n "$@" "$bundle""#,
        )
        .arg("diffloupe-update")
        .arg(std::process::id().to_string())
        .arg(bundle)
        .arg(staged)
        .arg(sibling(bundle, "old"))
        .arg(downloads)
        .arg(not_installed(image, "the app could not be replaced"))
        .arg(if reopen { "1" } else { "0" })
        .args(carried)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(drop)
        .map_err(|_| {
            let _ = std::fs::remove_dir_all(staged);
            not_installed(image, "the update helper could not start")
        })
}

pub fn install(image: &Path, bundle: &Path, reopen: bool) -> Result<(), String> {
    let staged = stage(image, bundle)?;
    swap_after_exit(image, bundle, &staged, reopen)
}
