use crate::error::{Error, Result};
use crate::events::{CoreEvent, EventSink};
use crate::platform::Platform;
use crate::shellenv::ShellEnv;
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
#[cfg(unix)]
use rustix::process::{Pid, Signal, kill_process};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, mpsc};
use std::time::{Duration, Instant};
use ts_rs::TS;

const BATCH_LIMIT: usize = 256 * 1024;
const BATCH_WAIT: Duration = Duration::from_millis(8);
const FLOW_LIMIT: usize = 1024 * 1024;
const FLOW_WAIT: Duration = Duration::from_secs(2);
#[cfg(unix)]
const HANGUP_WAIT: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalSession {
    pub id: String,
    pub path: String,
}

struct Session {
    path: String,
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    flow: Arc<Flow>,
}

#[derive(Default)]
struct Flow {
    unacked: Mutex<usize>,
    acked: Condvar,
    closed: AtomicBool,
}

impl Flow {
    fn reserve(&self, bytes: usize) {
        let Ok(mut unacked) = self.unacked.lock() else {
            return;
        };
        while *unacked > FLOW_LIMIT && !self.closed.load(Ordering::SeqCst) {
            let before = *unacked;
            let Ok((next, _)) = self.acked.wait_timeout(unacked, FLOW_WAIT) else {
                return;
            };
            unacked = next;
            if *unacked == before {
                *unacked = 0;
            }
        }
        *unacked += bytes;
    }

    fn ack(&self, bytes: usize) {
        if let Ok(mut unacked) = self.unacked.lock() {
            *unacked = unacked.saturating_sub(bytes);
        }
        self.acked.notify_all();
    }

    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.acked.notify_all();
    }
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

#[derive(Default)]
pub struct Terminals {
    sessions: Sessions,
    next: AtomicU64,
}

impl Terminals {
    pub fn open(
        &self,
        env: &ShellEnv,
        root: &Path,
        cols: u16,
        rows: u16,
        events: Arc<dyn EventSink>,
    ) -> Result<TerminalSession> {
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(terminal_error)?;
        let mut command = CommandBuilder::new(env.shell());
        for arg in shell_args(Platform::CURRENT, env.shell()) {
            command.arg(arg);
        }
        command.cwd(root);
        command.env("PATH", env.path());
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if let Some(lang) = default_locale(|name| std::env::var(name).ok()) {
            command.env("LANG", lang);
        }
        let child = pair.slave.spawn_command(command).map_err(terminal_error)?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(terminal_error)?;
        let writer = pair.master.take_writer().map_err(terminal_error)?;
        let id = format!("terminal-{}", self.next.fetch_add(1, Ordering::SeqCst) + 1);
        let path = root.display().to_string();
        let flow = Arc::new(Flow::default());
        let session = Session {
            path: path.clone(),
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            flow: flow.clone(),
        };
        self.lock()?.insert(id.clone(), session);
        stream(reader, id.clone(), events, flow, self.sessions.clone());
        Ok(TerminalSession { id, path })
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let Some(writer) = self.lock()?.get(id).map(|session| session.writer.clone()) else {
            return Ok(());
        };
        let mut writer = writer
            .lock()
            .map_err(|_| Error::Store("terminal writer lock poisoned".into()))?;
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub fn ack(&self, id: &str, bytes: usize) -> Result<()> {
        if let Some(flow) = self.lock()?.get(id).map(|session| session.flow.clone()) {
            flow.ack(bytes);
        }
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.lock()?;
        let Some(session) = sessions.get(id) else {
            return Ok(());
        };
        session
            .master
            .resize(size(cols, rows))
            .map_err(terminal_error)
    }

    pub fn close(&self, id: &str) -> Result<()> {
        if let Some(session) = self.lock()?.remove(id) {
            end(session);
        }
        Ok(())
    }

    pub fn close_all(&self) {
        let sessions: Vec<Session> = match self.sessions.lock() {
            Ok(mut sessions) => sessions.drain().map(|(_, session)| session).collect(),
            Err(_) => return,
        };
        for session in sessions {
            end(session);
        }
    }

    pub fn list(&self, root: &Path) -> Result<Vec<TerminalSession>> {
        let path = root.display().to_string();
        let mut sessions: Vec<TerminalSession> = self
            .lock()?
            .iter()
            .filter(|(_, session)| session.path == path)
            .map(|(id, session)| TerminalSession {
                id: id.clone(),
                path: session.path.clone(),
            })
            .collect();
        sessions.sort_by_key(|session| number(&session.id));
        Ok(sessions)
    }

    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, Session>>> {
        self.sessions
            .lock()
            .map_err(|_| Error::Store("terminal lock poisoned".into()))
    }
}

impl Drop for Terminals {
    fn drop(&mut self) {
        self.close_all();
    }
}

#[cfg(unix)]
fn pid(raw: Option<u32>) -> Option<Pid> {
    raw.and_then(|pid| i32::try_from(pid).ok())
        .and_then(Pid::from_raw)
}

#[cfg(not(unix))]
fn end(mut session: Session) {
    session.flow.close();
    #[cfg(windows)]
    if let Some(shell) = session.child.process_id() {
        crate::platform::kill_tree(shell);
    }
    let _ = session.child.kill();
    let _ = session.child.wait();
}

#[cfg(unix)]
fn end(mut session: Session) {
    session.flow.close();
    let shell = session.child.process_id();
    let tree = shell.map(descendants).unwrap_or_default();
    if let Some(shell) = pid(shell) {
        let _ = kill_process(shell, Signal::HUP);
    }
    let start = Instant::now();
    while start.elapsed() < HANGUP_WAIT {
        if let Ok(Some(_)) = session.child.try_wait() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let left: Vec<Pid> = tree
        .into_iter()
        .filter_map(|raw| pid(Some(raw)))
        .filter(|process| kill_process(*process, Signal::HUP).is_ok())
        .collect();
    if !left.is_empty() {
        std::thread::sleep(Duration::from_millis(200));
        for process in left {
            let _ = kill_process(process, Signal::KILL);
        }
    }
    let _ = session.child.kill();
    let _ = session.child.wait();
}

#[cfg(unix)]
fn descendants(root: u32) -> Vec<u32> {
    let Ok(output) = std::process::Command::new("ps")
        .args(["-A", "-o", "pid=,ppid="])
        .output()
    else {
        return Vec::new();
    };
    let pairs: Vec<(u32, u32)> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
        })
        .collect();
    let mut found = vec![root];
    let mut index = 0;
    while let Some(&parent) = found.get(index) {
        found.extend(
            pairs
                .iter()
                .filter(|(_, ppid)| *ppid == parent)
                .map(|(child, _)| *child),
        );
        index += 1;
    }
    found.remove(0);
    found
}

fn stream(
    mut reader: Box<dyn Read + Send>,
    id: String,
    events: Arc<dyn EventSink>,
    flow: Arc<Flow>,
    sessions: Sessions,
) {
    let (chunks, received) = mpsc::sync_channel::<Vec<u8>>(64);
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if chunks.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        while let Ok(first) = received.recv() {
            pending.extend_from_slice(&first);
            let deadline = Instant::now() + BATCH_WAIT;
            while pending.len() < BATCH_LIMIT {
                let left = deadline.saturating_duration_since(Instant::now());
                match received.recv_timeout(left) {
                    Ok(more) => pending.extend_from_slice(&more),
                    Err(_) => break,
                }
            }
            let text = take_text(&mut pending);
            if !text.is_empty() {
                flow.reserve(text.encode_utf16().count());
                events.emit(CoreEvent::TerminalOutput {
                    id: id.clone(),
                    data: text,
                });
            }
        }
        let ended = sessions.lock().ok().and_then(|mut all| all.remove(&id));
        if let Some(mut session) = ended {
            let _ = session.child.wait();
        }
        events.emit(CoreEvent::TerminalExit { id });
    });
}

pub fn default_locale(get: impl Fn(&str) -> Option<String>) -> Option<&'static str> {
    default_locale_on(Platform::CURRENT, get)
}

pub fn default_locale_on(
    platform: Platform,
    get: impl Fn(&str) -> Option<String>,
) -> Option<&'static str> {
    if platform == Platform::Windows {
        return None;
    }
    let set = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|name| get(name).is_some_and(|value| !value.is_empty()));
    (!set).then_some("en_US.UTF-8")
}

pub fn shell_args(platform: Platform, shell: &str) -> Vec<&'static str> {
    match platform {
        Platform::Macos | Platform::Linux => vec!["-l"],
        Platform::Windows => {
            let lower = shell.to_ascii_lowercase();
            if lower.ends_with("cmd.exe") || lower == "cmd" {
                vec!["/d"]
            } else {
                vec!["-NoLogo"]
            }
        }
    }
}

fn take_text(pending: &mut Vec<u8>) -> String {
    let mut text = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                text.push_str(valid);
                pending.clear();
                return text;
            }
            Err(error) => {
                let good = error.valid_up_to();
                text.push_str(&String::from_utf8_lossy(&pending[..good]));
                let Some(bad) = error.error_len() else {
                    pending.drain(..good);
                    return text;
                };
                text.push(char::REPLACEMENT_CHARACTER);
                pending.drain(..good + bad);
            }
        }
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn number(id: &str) -> u64 {
    id.rsplit('-')
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or_default()
}

fn terminal_error(error: impl std::fmt::Display) -> Error {
    Error::Io(std::io::Error::other(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_locale_falls_back_to_utf8() {
        assert_eq!(
            default_locale_on(Platform::Macos, |_| None),
            Some("en_US.UTF-8")
        );
        assert_eq!(
            default_locale_on(Platform::Linux, |_| None),
            Some("en_US.UTF-8")
        );
        assert_eq!(default_locale_on(Platform::Windows, |_| None), None);
        assert_eq!(
            default_locale_on(Platform::Macos, |name| (name == "LANG").then(|| "".into())),
            Some("en_US.UTF-8")
        );
        assert_eq!(
            default_locale_on(Platform::Macos, |name| (name == "LC_CTYPE")
                .then(|| "UTF-8".into())),
            None
        );
        assert_eq!(
            default_locale_on(Platform::Macos, |name| (name == "LANG")
                .then(|| "de_DE.UTF-8".into())),
            None
        );
    }

    #[test]
    fn shell_arguments_match_platform_and_program() {
        assert_eq!(shell_args(Platform::Macos, "/bin/zsh"), vec!["-l"]);
        assert_eq!(shell_args(Platform::Linux, "/bin/sh"), vec!["-l"]);
        assert_eq!(shell_args(Platform::Windows, "pwsh.exe"), vec!["-NoLogo"]);
        assert_eq!(
            shell_args(Platform::Windows, "powershell.exe"),
            vec!["-NoLogo"]
        );
        assert_eq!(
            shell_args(
                Platform::Windows,
                "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
            ),
            vec!["-NoLogo"]
        );
        assert_eq!(shell_args(Platform::Windows, "cmd.exe"), vec!["/d"]);
        assert_eq!(shell_args(Platform::Windows, "cmd"), vec!["/d"]);
        assert_eq!(
            shell_args(Platform::Windows, "C:\\Windows\\System32\\cmd.exe"),
            vec!["/d"]
        );
    }

    #[test]
    fn a_character_split_between_reads_waits_for_its_end() {
        let mut pending = "ab€".as_bytes()[..4].to_vec();
        assert_eq!(take_text(&mut pending), "ab");
        assert_eq!(pending.len(), 2);
        pending.push(0xac);
        assert_eq!(take_text(&mut pending), "€");
        assert!(pending.is_empty());
    }

    #[test]
    fn a_broken_byte_is_replaced_and_skipped() {
        let mut pending = vec![b'a', 0xff, b'b'];
        assert_eq!(take_text(&mut pending), "a\u{fffd}b");
        assert!(pending.is_empty());
    }
}
