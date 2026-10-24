use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct ShellEnv {
    path: Arc<OnceLock<String>>,
    shell: String,
}

impl ShellEnv {
    pub fn detect() -> ShellEnv {
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

    pub fn from_path(path: &str) -> ShellEnv {
        ShellEnv {
            path: Arc::new(OnceLock::from(path.to_string())),
            shell: "/bin/sh".to_string(),
        }
    }

    pub fn path(&self) -> &str {
        self.path.wait()
    }

    pub fn shell(&self) -> &str {
        &self.shell
    }

    pub fn curl(&self) -> Command {
        let mut cmd = Command::new("/usr/bin/curl");
        cmd.stdin(Stdio::null());
        cmd
    }

    pub fn git(&self, cwd: &Path) -> Command {
        let mut cmd = Command::new("git");
        cmd.current_dir(cwd)
            .env("PATH", self.path())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .stdin(Stdio::null());
        cmd
    }
}

fn login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

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
