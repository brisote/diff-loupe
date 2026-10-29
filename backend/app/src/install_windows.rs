use diffloupe_core::update::{self, PackageKind};
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;

pub type Target = PathBuf;

pub fn version(image: &Path) -> String {
    let name = image
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    update::package_version(name, PackageKind::Setup)
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

fn fits(image: &Path) -> bool {
    image
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| update::package_version(name, PackageKind::Setup).is_some())
}

pub fn helper_script(
    pid: u32,
    setup: &Path,
    target: &Path,
    downloads: &Path,
    failure: &str,
    reopen: bool,
) -> String {
    let setup_path = setup.display().to_string().replace('\'', "''");
    let target_path = target.display().to_string().replace('\'', "''");
    let downloads_path = downloads.display().to_string().replace('\'', "''");
    let failed_path = downloads
        .join("failed")
        .display()
        .to_string()
        .replace('\'', "''");
    let fail_val = failure.replace('\'', "''");
    let reopen_clause = if reopen {
        format!("Start-Process -FilePath '{target_path}';")
    } else {
        String::new()
    };
    format!(
        "$p = Get-Process -Id {pid} -ErrorAction SilentlyContinue; \
         if ($p) {{ $p.WaitForExit(60000) }}; \
         $res = Start-Process -FilePath '{setup_path}' -ArgumentList '/S' -Wait -PassThru; \
         if ($res.ExitCode -ne 0) {{ \
             Set-Content -Path '{failed_path}' -Value '{fail_val}'; \
         }} else {{ \
             Remove-Item -Recurse -Force '{downloads_path}' -ErrorAction SilentlyContinue; \
             {reopen_clause} \
         }}"
    )
}

#[cfg(windows)]
pub fn install(image: &Path, target: &Target, reopen: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if !fits(image) {
        return Err(not_installed(
            image,
            "it is not a setup program that this system installs",
        ));
    }
    if !update::verified(image) {
        return Err(not_installed(
            image,
            "the downloaded package is not the one that was checked",
        ));
    }
    let downloads = image.parent().unwrap_or(image);
    let failure = not_installed(image, "the setup program did not finish");
    let script = helper_script(
        std::process::id(),
        image,
        target,
        downloads,
        &failure,
        reopen,
    );

    Command::new("powershell.exe")
        .args([
            "-ExecutionPolicy",
            "Bypass",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(drop)
        .map_err(|_| not_installed(image, "the update helper could not start"))
}

#[cfg(not(windows))]
pub fn install(image: &Path, _target: &Target, _reopen: bool) -> Result<(), String> {
    if !fits(image) {
        return Err(not_installed(
            image,
            "it is not a setup program that this system installs",
        ));
    }
    if !update::verified(image) {
        return Err(not_installed(
            image,
            "the downloaded package is not the one that was checked",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_comes_from_the_setup_package_name() {
        assert_eq!(
            version(Path::new("/x/Diffloupe-0.4.0-windows-x64-setup.exe")),
            "0.4.0"
        );
        assert_eq!(version(Path::new("/x/other.exe")), "the new version");
    }

    #[test]
    fn only_a_setup_package_is_accepted() {
        let setup = Path::new("/x/Diffloupe-0.4.0-windows-x64-setup.exe");
        let deb = Path::new("/x/Diffloupe-0.4.0-linux-amd64.deb");
        assert!(fits(setup));
        assert!(!fits(deb));
        assert!(!fits(Path::new("/x/Diffloupe-0.4.0.dmg")));
    }

    #[test]
    fn a_package_that_was_not_verified_is_never_installed() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("Diffloupe-0.4.0-windows-x64-setup.exe");
        std::fs::write(&image, b"planted").unwrap();
        let target = PathBuf::from("C:\\Program Files\\Diffloupe\\diffloupe.exe");
        let refused = install(&image, &target, false).unwrap_err();
        assert!(refused.contains("not the one that was checked"));
        assert!(image.exists());
    }

    #[test]
    fn a_failed_install_names_the_version_and_keeps_the_old_one() {
        let text = not_installed(
            Path::new("/x/Diffloupe-0.4.0-windows-x64-setup.exe"),
            "the setup program did not finish",
        );
        assert!(text.contains("Diffloupe 0.4.0 was not installed"));
        assert!(text.contains("the setup program did not finish"));
        assert!(text.ends_with("is unchanged."));
    }

    #[test]
    fn helper_script_contains_pid_and_silent_flag_and_escapes_quotes() {
        let script = helper_script(
            1234,
            Path::new("C:\\setup's\\setup.exe"),
            Path::new("C:\\app's\\diffloupe.exe"),
            Path::new("C:\\downloads"),
            "failed 'reason'",
            true,
        );
        assert!(script.contains("Get-Process -Id 1234"));
        assert!(script.contains("C:\\setup''s\\setup.exe"));
        assert!(script.contains("'/S'"));
        assert!(script.contains("C:\\app''s\\diffloupe.exe"));
        assert!(script.contains("failed ''reason''"));
    }
}
