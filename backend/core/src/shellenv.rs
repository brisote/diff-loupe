use crate::platform::{self, Platform};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
#[cfg(unix)]
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct ShellEnv {
    path: Arc<OnceLock<String>>,
    shell: String,
}

impl ShellEnv {
    pub fn detect() -> ShellEnv {
        #[cfg(unix)]
        {
            let path = Arc::new(OnceLock::new());
            let cell = path.clone();
            std::thread::spawn(move || {
                let found =
                    login_shell_path().unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
                let _ = cell.set(found);
            });
            ShellEnv {
                path,
                shell: login_shell(),
            }
        }
        #[cfg(windows)]
        {
            let path_val = windows_path();
            let shell = windows_shell(&path_val, |name| std::env::var(name).ok(), |p| p.is_file());
            ShellEnv {
                path: Arc::new(OnceLock::from(path_val)),
                shell,
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            ShellEnv {
                path: Arc::new(OnceLock::from(std::env::var("PATH").unwrap_or_default())),
                shell: "powershell.exe".to_string(),
            }
        }
    }

    pub fn from_path(path: &str) -> ShellEnv {
        ShellEnv {
            path: Arc::new(OnceLock::from(path.to_string())),
            shell: "/bin/sh".to_string(),
        }
    }

    pub fn with_shell(mut self, shell: &str) -> ShellEnv {
        self.shell = shell.to_string();
        self
    }

    pub fn path(&self) -> &str {
        self.path.wait()
    }

    pub fn shell(&self) -> &str {
        &self.shell
    }

    pub fn curl(&self) -> Command {
        let mut cmd = Command::new(curl_program(Platform::CURRENT, |name| {
            std::env::var(name).ok()
        }));
        platform::hidden(&mut cmd).stdin(Stdio::null());
        cmd
    }

    pub fn git(&self, cwd: &Path) -> Command {
        let mut cmd = Command::new("git");
        platform::hidden(&mut cmd)
            .current_dir(cwd)
            .env("PATH", self.path())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .stdin(Stdio::null());
        cmd
    }
}

pub fn curl_program(platform: Platform, get: impl Fn(&str) -> Option<String>) -> String {
    match platform {
        Platform::Macos => "/usr/bin/curl".to_string(),
        Platform::Windows => {
            let root = get("SystemRoot").unwrap_or_else(|| "C:\\Windows".to_string());
            format!("{}\\System32\\curl.exe", root.trim_end_matches('\\'))
        }
        Platform::Linux => "curl".to_string(),
    }
}

#[cfg(unix)]
fn login_shell() -> String {
    login_shell_from(Platform::CURRENT, |name| std::env::var(name).ok())
}

pub fn login_shell_from(platform: Platform, get: impl Fn(&str) -> Option<String>) -> String {
    get("SHELL")
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| {
            match platform {
                Platform::Macos => "/bin/zsh",
                Platform::Linux => "/bin/sh",
                Platform::Windows => "powershell.exe",
            }
            .to_string()
        })
}

pub fn expand_vars(raw: &str, get: impl Fn(&str) -> Option<String>) -> String {
    let mut result = String::with_capacity(raw.len());
    let mut remaining = raw;
    while let Some(start) = remaining.find('%') {
        result.push_str(&remaining[..start]);
        let after = &remaining[start + 1..];
        if let Some(end) = after.find('%') {
            let name = &after[..end];
            if !name.is_empty()
                && !name.contains('\\')
                && !name.contains('/')
                && !name.contains(';')
                && let Some(val) = get(name)
            {
                result.push_str(&val);
                remaining = &after[end + 1..];
                continue;
            }
            result.push('%');
            remaining = after;
        } else {
            result.push_str(&remaining[start..]);
            remaining = "";
            break;
        }
    }
    result.push_str(remaining);
    result
}

pub fn join_windows_paths(system: Option<&str>, user: Option<&str>) -> Option<String> {
    let sys = clean_path(system);
    let usr = clean_path(user);
    match (sys, usr) {
        (Some(sys), Some(usr)) => Some(format!("{sys};{usr}")),
        (Some(sys), None) => Some(sys.to_string()),
        (None, Some(usr)) => Some(usr.to_string()),
        (None, None) => None,
    }
}

fn clean_path(s: Option<&str>) -> Option<&str> {
    s.map(|v| v.trim().trim_matches(';').trim())
        .filter(|v| !v.is_empty())
}

pub fn choose_windows_shell(path: &str, exists: impl Fn(&Path) -> bool) -> String {
    for dir in path.split(';') {
        let dir = dir.trim().trim_matches('"').trim();
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join("pwsh.exe");
        if exists(&candidate) {
            return "pwsh.exe".to_string();
        }
    }
    "powershell.exe".to_string()
}

pub fn windows_shell(
    path: &str,
    get: impl Fn(&str) -> Option<String>,
    exists: impl Fn(&Path) -> bool,
) -> String {
    if let Some(shell) = get("SHELL").filter(|s| !s.is_empty()) {
        return shell;
    }
    choose_windows_shell(path, exists)
}

#[cfg(windows)]
fn read_reg_string(key: &winreg::RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .or_else(|_| key.get_value::<String, _>(&name.to_uppercase()))
        .ok()
}

#[cfg(windows)]
fn read_registry_path() -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let system = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
        .ok()
        .and_then(|key| read_reg_string(&key, "Path"));

    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .ok()
        .and_then(|key| read_reg_string(&key, "Path"));

    let joined = join_windows_paths(system.as_deref(), user.as_deref())?;
    Some(expand_vars(&joined, |name| std::env::var(name).ok()))
}

#[cfg(windows)]
fn windows_path() -> String {
    read_registry_path().unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
}

#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    let shell = login_shell();
    let mut child = Command::new(shell)
        .args(["-l", "-c", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = std::io::Read::read_to_string(&mut stdout, &mut text);
        let _ = sender.send(text);
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    parse_path(&receiver.recv_timeout(Duration::from_secs(1)).ok()?)
}

#[cfg(unix)]
fn parse_path(raw: &str) -> Option<String> {
    let line = raw.lines().last()?.trim();
    if line.is_empty() || !line.contains('/') {
        None
    } else {
        Some(line.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shell_is_the_users_own_and_falls_back_to_the_system_default() {
        let set = |_: &str| Some("/usr/bin/fish".to_string());
        let empty = |_: &str| Some(String::new());
        let none = |_: &str| None;
        assert_eq!(login_shell_from(Platform::Linux, set), "/usr/bin/fish");
        assert_eq!(login_shell_from(Platform::Macos, none), "/bin/zsh");
        assert_eq!(login_shell_from(Platform::Linux, none), "/bin/sh");
        assert_eq!(login_shell_from(Platform::Linux, empty), "/bin/sh");
        assert_eq!(login_shell_from(Platform::Windows, none), "powershell.exe");
        assert_eq!(login_shell_from(Platform::Windows, set), "/usr/bin/fish");
    }

    #[test]
    fn expanding_variables_resolves_known_and_leaves_unknown() {
        let get = |name: &str| match name {
            "SystemRoot" => Some("C:\\Windows".to_string()),
            "USERPROFILE" => Some("C:\\Users\\User".to_string()),
            _ => None,
        };
        assert_eq!(
            expand_vars("%SystemRoot%\\System32;%USERPROFILE%\\bin", get),
            "C:\\Windows\\System32;C:\\Users\\User\\bin"
        );
        assert_eq!(
            expand_vars("C:\\tools;%UNKNOWN%\\bin;%SystemRoot%", get),
            "C:\\tools;%UNKNOWN%\\bin;C:\\Windows"
        );
        assert_eq!(
            expand_vars("C:\\tools%unmatched", get),
            "C:\\tools%unmatched"
        );
        assert_eq!(expand_vars("C:\\a%b\\c%d", get), "C:\\a%b\\c%d");
        assert_eq!(expand_vars("", get), "");
    }

    #[test]
    fn joining_windows_paths_combines_system_before_user() {
        assert_eq!(
            join_windows_paths(Some("C:\\sys;"), Some(";C:\\usr;")),
            Some("C:\\sys;C:\\usr".to_string())
        );
        assert_eq!(
            join_windows_paths(Some("C:\\sys"), None),
            Some("C:\\sys".to_string())
        );
        assert_eq!(
            join_windows_paths(None, Some("C:\\usr")),
            Some("C:\\usr".to_string())
        );
        assert_eq!(join_windows_paths(None, None), None);
        assert_eq!(join_windows_paths(Some("  "), Some("")), None);
        assert_eq!(join_windows_paths(Some(";;"), Some(" ; ")), None);
    }

    #[test]
    fn choosing_windows_shell_prefers_pwsh_when_present() {
        let has_pwsh =
            |p: &Path| p.to_string_lossy().contains("PowerShell") && p.ends_with("pwsh.exe");
        let path = "C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7;C:\\bin";
        assert_eq!(choose_windows_shell(path, has_pwsh), "pwsh.exe");
        let quoted = "C:\\Windows\\System32;\"C:\\Program Files\\PowerShell\\7\";C:\\bin";
        assert_eq!(choose_windows_shell(quoted, has_pwsh), "pwsh.exe");
        assert_eq!(
            choose_windows_shell("C:\\Windows;C:\\bin", has_pwsh),
            "powershell.exe"
        );
        assert_eq!(choose_windows_shell("", has_pwsh), "powershell.exe");
    }

    #[test]
    fn windows_shell_respects_shell_env_override() {
        let none = |_: &str| None;
        let set = |_: &str| Some("cmd.exe".to_string());
        assert_eq!(windows_shell("C:\\bin", set, |_| false), "cmd.exe");
        assert_eq!(windows_shell("C:\\bin", none, |_| false), "powershell.exe");
    }

    #[test]
    fn a_shell_override_can_be_applied() {
        let env = ShellEnv::from_path("/bin").with_shell("/bin/bash");
        assert_eq!(env.shell(), "/bin/bash");
    }

    #[test]
    fn curl_comes_from_the_place_each_system_keeps_it() {
        let none = |_: &str| None;
        assert_eq!(curl_program(Platform::Macos, none), "/usr/bin/curl");
        assert_eq!(curl_program(Platform::Linux, none), "curl");
        assert_eq!(
            curl_program(Platform::Windows, none),
            "C:\\Windows\\System32\\curl.exe"
        );
        assert_eq!(
            curl_program(Platform::Windows, |name| (name == "SystemRoot")
                .then(|| "D:\\Win\\".into())),
            "D:\\Win\\System32\\curl.exe"
        );
    }

    #[cfg(unix)]
    #[test]
    fn parse_takes_the_last_line_and_ignores_noise() {
        assert_eq!(
            parse_path("welcome\n/usr/bin:/bin"),
            Some("/usr/bin:/bin".into())
        );
        assert_eq!(parse_path(""), None);
        assert_eq!(parse_path("no path here"), None);
    }

    #[test]
    fn a_fixed_path_is_ready_at_once() {
        assert_eq!(ShellEnv::from_path("/usr/bin:/bin").path(), "/usr/bin:/bin");
    }

    #[test]
    fn detect_finds_git() {
        let env = ShellEnv::detect();
        let out = env.git(Path::new(".")).arg("--version").output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).starts_with("git version"));
    }
}
