use serde::Serialize;
use std::process::{Child, Command};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Platform {
    Macos,
    Windows,
    Linux,
}

impl Platform {
    pub const CURRENT: Platform = if cfg!(target_os = "macos") {
        Platform::Macos
    } else if cfg!(windows) {
        Platform::Windows
    } else {
        Platform::Linux
    };

    pub fn parse(name: &str) -> Option<Platform> {
        match name {
            "macos" => Some(Platform::Macos),
            "windows" => Some(Platform::Windows),
            "linux" => Some(Platform::Linux),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Platform::Macos => "macos",
            Platform::Windows => "windows",
            Platform::Linux => "linux",
        }
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

#[cfg(windows)]
pub fn hidden(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
pub fn hidden(cmd: &mut Command) -> &mut Command {
    cmd
}

#[cfg(windows)]
pub fn isolate(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
}

#[cfg(unix)]
pub fn isolate(cmd: &mut Command) -> &mut Command {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0)
}

#[cfg(unix)]
pub fn stop_tree(child: &mut Child) {
    use std::time::Duration;
    let group = i32::try_from(child.id())
        .ok()
        .and_then(rustix::process::Pid::from_raw);
    let signal = |signal| {
        if let Some(group) = group {
            let _ = rustix::process::kill_process_group(group, signal);
        }
    };
    signal(rustix::process::Signal::TERM);
    for _ in 0..40 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    signal(rustix::process::Signal::KILL);
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
pub fn stop_tree(child: &mut Child) {
    use std::time::Duration;
    taskkill(child.id(), false);
    for _ in 0..40 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    taskkill(child.id(), true);
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
pub fn kill_tree(pid: u32) {
    taskkill(pid, true);
}

#[cfg(windows)]
fn taskkill(pid: u32, force: bool) {
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/T"]);
    if force {
        command.arg("/F");
    }
    let _ = hidden(&mut command).output();
}

pub fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

pub fn os_name(
    platform: Platform,
    probe: &dyn Fn(&str, &[&str]) -> Option<String>,
) -> Option<String> {
    match platform {
        Platform::Macos => probe("/usr/bin/sw_vers", &["-productVersion"])
            .map(|version| format!("macOS {version}")),
        Platform::Linux => std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|release| linux_os(&release)),
        Platform::Windows => {
            probe("cmd", &["/d", "/c", "ver"]).and_then(|output| windows_os(&output))
        }
    }
}

pub fn linux_os(release: &str) -> Option<String> {
    let value = |key: &str| {
        release.lines().find_map(|line| {
            line.strip_prefix(key)
                .and_then(|rest| rest.strip_prefix('='))
                .map(|rest| rest.trim().trim_matches('"').to_string())
                .filter(|rest| !rest.is_empty())
        })
    };
    value("PRETTY_NAME").or_else(|| value("NAME"))
}

pub fn windows_os(ver: &str) -> Option<String> {
    let inside = ver.split_once('[')?.1.split(']').next()?;
    let version = inside.split_whitespace().last()?;
    let build: u32 = version.split('.').nth(2)?.parse().ok()?;
    let name = if build >= 22000 { "11" } else { "10" };
    Some(format!("Windows {name} (build {build})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_current_platform_is_the_one_the_core_was_built_for() {
        let expected = if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(windows) {
            "windows"
        } else {
            "linux"
        };
        assert_eq!(Platform::CURRENT.name(), expected);
    }

    #[test]
    fn names_round_trip_and_unknown_names_are_refused() {
        for platform in [Platform::Macos, Platform::Windows, Platform::Linux] {
            assert_eq!(Platform::parse(platform.name()), Some(platform));
        }
        assert_eq!(Platform::parse("beos"), None);
        assert_eq!(Platform::parse(""), None);
    }

    #[test]
    fn a_linux_release_file_gives_the_pretty_name() {
        let release = "NAME=\"Ubuntu\"\nVERSION=\"24.04.1 LTS\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\n";
        assert_eq!(linux_os(release).as_deref(), Some("Ubuntu 24.04.1 LTS"));
        assert_eq!(linux_os("NAME=Fedora\n").as_deref(), Some("Fedora"));
        assert_eq!(linux_os("ID=x\n"), None);
        assert_eq!(linux_os("PRETTY_NAME=\n"), None);
    }

    #[test]
    fn the_windows_ver_output_gives_the_marketing_name_and_build() {
        assert_eq!(
            windows_os("\r\nMicrosoft Windows [Version 10.0.26100.1742]\r\n").as_deref(),
            Some("Windows 11 (build 26100)")
        );
        assert_eq!(
            windows_os("Microsoft Windows [Version 10.0.19045.4651]").as_deref(),
            Some("Windows 10 (build 19045)")
        );
        assert_eq!(
            windows_os("Microsoft Windows [Versión 10.0.22631.1]").as_deref(),
            Some("Windows 11 (build 22631)")
        );
        assert_eq!(windows_os("nonsense"), None);
        assert_eq!(windows_os("Microsoft Windows [Version 10.0]"), None);
    }

    #[test]
    fn the_first_line_skips_the_blank_lines_that_cmd_ver_prints_first() {
        let text = "\r\nMicrosoft Windows [Version 10.0.26100.1742]\r\n";
        assert_eq!(
            first_line(text).as_deref(),
            Some("Microsoft Windows [Version 10.0.26100.1742]")
        );
        assert_eq!(first_line("\n  \n"), None);
        assert_eq!(
            first_line("git version 2.50.1\n").as_deref(),
            Some("git version 2.50.1")
        );
    }

    #[test]
    fn the_os_name_asks_each_platform_its_own_way() {
        let probe = |program: &str, args: &[&str]| match (program, args) {
            ("/usr/bin/sw_vers", ["-productVersion"]) => Some("15.3".to_string()),
            ("cmd", ["/d", "/c", "ver"]) => {
                Some("Microsoft Windows [Version 10.0.22631.1]".to_string())
            }
            _ => None,
        };
        assert_eq!(
            os_name(Platform::Macos, &probe).as_deref(),
            Some("macOS 15.3")
        );
        assert_eq!(
            os_name(Platform::Windows, &probe).as_deref(),
            Some("Windows 11 (build 22631)")
        );
        assert_eq!(os_name(Platform::Macos, &|_, _| None), None);
    }

    #[cfg(unix)]
    #[test]
    fn stopping_a_tree_ends_the_child_and_its_group() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 60 & wait"]);
        let mut child = isolate(&mut command).spawn().unwrap();
        stop_tree(&mut child);
        assert!(child.try_wait().unwrap().is_some());
    }
}
