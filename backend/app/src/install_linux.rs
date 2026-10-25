use crate::package::{self, Owner};
use diffloupe_core::update::{self, PackageKind};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

pub type Target = Owner;

pub fn version(image: &Path) -> String {
    let name = image
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    [PackageKind::Deb, PackageKind::Rpm]
        .into_iter()
        .find_map(|kind| update::package_version(name, kind))
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

pub fn installed_but_not_restarted(image: &Path, why: &str) -> String {
    format!(
        "Diffloupe {} was installed, but it could not restart ({why}). Start Diffloupe again to use it.",
        version(image)
    )
}

fn fits(image: &Path, kind: PackageKind) -> bool {
    image
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| update::package_version(name, kind).is_some())
}

fn restart_after(pid: u32, exe: &Path) -> Result<(), String> {
    Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; [ -x "$2" ] && exec "$2""#)
        .arg("diffloupe-update")
        .arg(pid.to_string())
        .arg(exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(drop)
        .map_err(|e| e.to_string())
}

pub fn install(image: &Path, target: &Target, reopen: bool) -> Result<(), String> {
    if !fits(image, target.kind) {
        return Err(not_installed(
            image,
            "it is not a package that this system's package manager installs",
        ));
    }
    if !update::verified(image) {
        return Err(not_installed(
            image,
            "the downloaded package is not the one that was checked",
        ));
    }
    package::run(&package::installation(target.kind, image))
        .map_err(|why| not_installed(image, &format!("the package manager said: {why}")))?;
    if let Some(downloads) = image.parent() {
        let _ = std::fs::remove_dir_all(downloads);
    }
    if reopen {
        let started = package::executable()
            .ok_or_else(|| "its program could not be found".to_string())
            .and_then(|exe| restart_after(std::process::id(), &exe));
        if let Err(why) = started {
            return Err(installed_but_not_restarted(image, &why));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_comes_from_the_package_name() {
        assert_eq!(
            version(Path::new("/x/Diffloupe-0.3.0-linux-amd64.deb")),
            "0.3.0"
        );
        assert_eq!(
            version(Path::new("/x/Diffloupe-0.3.0-linux-x86_64.rpm")),
            "0.3.0"
        );
        assert_eq!(version(Path::new("/x/other.bin")), "the new version");
    }

    #[test]
    fn only_a_package_of_the_owners_kind_is_installed() {
        let deb = Path::new("/x/Diffloupe-0.3.0-linux-amd64.deb");
        let rpm = Path::new("/x/Diffloupe-0.3.0-linux-x86_64.rpm");
        assert!(fits(deb, PackageKind::Deb));
        assert!(!fits(deb, PackageKind::Rpm));
        assert!(fits(rpm, PackageKind::Rpm));
        assert!(!fits(Path::new("/x/Diffloupe-0.3.0.dmg"), PackageKind::Deb));
        let owner = Owner {
            kind: PackageKind::Rpm,
            name: "diffloupe".to_string(),
        };
        let refused = install(deb, &owner, false).unwrap_err();
        assert!(refused.contains("was not installed because"));
        assert!(refused.contains("0.3.0"));
    }

    #[test]
    fn a_restart_that_fails_after_the_install_says_the_new_version_is_there() {
        let text = installed_but_not_restarted(
            Path::new("/x/Diffloupe-0.3.0-linux-amd64.deb"),
            "no shell",
        );
        assert!(text.contains("Diffloupe 0.3.0 was installed"));
        assert!(text.contains("no shell"));
        assert!(!text.contains("unchanged"));
    }

    #[test]
    fn a_package_that_was_not_verified_is_never_installed() {
        let dir = std::env::temp_dir().join(format!("diffloupe-unverified-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let image = dir.join("Diffloupe-0.3.0-linux-amd64.deb");
        std::fs::write(&image, b"planted").unwrap();
        let owner = Owner {
            kind: PackageKind::Deb,
            name: "diffloupe".to_string(),
        };
        let refused = install(&image, &owner, false).unwrap_err();
        assert!(refused.contains("not the one that was checked"));
        assert!(image.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_restart_helper_waits_for_the_old_process_and_handles_odd_paths() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("diffloupe restart's {}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("started");
        let exe = dir.join("new diffloupe");
        std::fs::write(&exe, "#!/bin/sh\necho up > \"$(dirname \"$0\")/started\"\n").unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut old = Command::new("sleep").arg("1").spawn().unwrap();
        restart_after(old.id(), &exe).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(!marker.exists(), "it started before the old process ended");
        old.wait().unwrap();
        for _ in 0..40 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(marker.exists(), "the new program never started");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_install_names_the_version_and_keeps_the_old_one() {
        let text = not_installed(
            Path::new("/x/Diffloupe-0.3.0-linux-amd64.deb"),
            "the package manager said: E: locked",
        );
        assert!(text.contains("Diffloupe 0.3.0 was not installed"));
        assert!(text.contains("E: locked"));
        assert!(text.ends_with("is unchanged."));
    }
}
