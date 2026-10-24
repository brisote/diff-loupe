#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, RecordedEvents};
use diffloupe_core::testutil::{TempRepo, test_env};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn open(repo: &TempRepo) -> (tempfile::TempDir, Core, Arc<RecordedEvents>, Value) {
    let data = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordedEvents::default());
    let core = Core::new(data.path(), test_env(), events.clone()).unwrap();
    let info = core
        .dispatch("open_repo", json!({"path": repo.path()}))
        .unwrap();
    (data, core, events, info["path"].clone())
}

fn call(core: &Core, cmd: &str, args: Value) -> Value {
    core.dispatch(cmd, args)
        .unwrap_or_else(|e| panic!("{cmd} failed: {e:?}"))
}

struct Output {
    events: Arc<RecordedEvents>,
    text: String,
}

impl Output {
    fn wait_for(&mut self, id: &str, wanted: &str) -> String {
        let start = Instant::now();
        loop {
            for event in self.events.take() {
                if let CoreEvent::TerminalOutput { id: from, data } = event
                    && from == id
                {
                    self.text.push_str(&data);
                }
            }
            if self.text.contains(wanted) {
                return self.text.clone();
            }
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "no {wanted:?} in {:?}",
                self.text
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn alive(pid: &str) -> bool {
    std::process::Command::new("kill")
        .args(["-0", pid])
        .status()
        .unwrap()
        .success()
}

#[test]
fn a_session_runs_commands_in_the_repository_and_closes_cleanly() {
    let repo = TempRepo::with_commit();
    let (_data, core, events, path) = open(&repo);
    let session = call(
        &core,
        "terminal_open",
        json!({ "path": path, "cols": 100, "rows": 30 }),
    );
    let id = session["id"].as_str().unwrap().to_string();
    let mut output = Output {
        events: events.clone(),
        text: String::new(),
    };
    call(
        &core,
        "terminal_write",
        json!({ "id": id, "data": "git status\n" }),
    );
    output.wait_for(&id, "On branch main");
    call(
        &core,
        "terminal_resize",
        json!({ "id": id, "cols": 60, "rows": 10 }),
    );
    call(
        &core,
        "terminal_write",
        json!({ "id": id, "data": "stty size; echo \"p\"\"id=$$\"\n" }),
    );
    let text = output.wait_for(&id, "pid=");
    assert!(text.contains("10 60"), "{text}");
    let pid = text
        .split("pid=")
        .last()
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string();
    assert!(alive(&pid));
    call(&core, "terminal_close", json!({ "id": id }));
    assert!(!alive(&pid), "the shell {pid} is still running");
    for (command, args) in [
        ("terminal_write", json!({ "id": id, "data": "x" })),
        ("terminal_ack", json!({ "id": id, "bytes": 1 })),
        (
            "terminal_resize",
            json!({ "id": id, "cols": 80, "rows": 24 }),
        ),
        ("terminal_close", json!({ "id": id })),
    ] {
        assert!(
            core.dispatch(command, args).is_ok(),
            "{command} after close"
        );
    }
}

#[test]
fn every_new_session_starts_in_the_repository_root() {
    let repo = TempRepo::with_commit();
    repo.write("src/main.kt", "x\n");
    let (_data, core, events, path) = open(&repo);
    let root = path.as_str().unwrap().to_string();
    let first = call(
        &core,
        "terminal_open",
        json!({ "path": path, "cols": 80, "rows": 24 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    let mut output = Output {
        events: events.clone(),
        text: String::new(),
    };
    call(
        &core,
        "terminal_write",
        json!({ "id": first, "data": "cd src && echo moved-$(pwd)\n" }),
    );
    output.wait_for(&first, &format!("moved-{root}/src"));
    let second = call(
        &core,
        "terminal_open",
        json!({ "path": path, "cols": 80, "rows": 24 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    let mut second_output = Output {
        events,
        text: String::new(),
    };
    call(
        &core,
        "terminal_write",
        json!({ "id": second, "data": "echo at-$(pwd)-end\n" }),
    );
    second_output.wait_for(&second, &format!("at-{root}-end"));
    let listed = call(&core, "terminal_list", json!({ "path": path }));
    let ids: Vec<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [first.as_str(), second.as_str()]);
    let other = TempRepo::with_commit();
    let other_path = call(&core, "open_repo", json!({ "path": other.path() }))["path"].clone();
    assert_eq!(
        call(&core, "terminal_list", json!({ "path": other_path })),
        json!([])
    );
    call(&core, "open_repo", json!({ "path": repo.path() }));
    assert_eq!(
        call(&core, "terminal_list", json!({ "path": path }))
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn an_exiting_shell_reports_its_end() {
    let repo = TempRepo::with_commit();
    let (_data, core, events, path) = open(&repo);
    let id = call(
        &core,
        "terminal_open",
        json!({ "path": path, "cols": 80, "rows": 24 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    call(
        &core,
        "terminal_write",
        json!({ "id": id, "data": "exit\n" }),
    );
    let start = Instant::now();
    let mut seen = Vec::new();
    while !seen
        .iter()
        .any(|e| matches!(e, CoreEvent::TerminalExit { id: ended } if *ended == id))
    {
        seen.extend(events.take());
        assert!(start.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn session(core: &Core, path: &Value) -> String {
    call(
        core,
        "terminal_open",
        json!({ "path": path, "cols": 80, "rows": 24 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn closing_a_session_ends_its_background_jobs() {
    let repo = TempRepo::with_commit();
    let (_data, core, events, path) = open(&repo);
    let id = session(&core, &path);
    let mut output = Output {
        events,
        text: String::new(),
    };
    call(
        &core,
        "terminal_write",
        json!({ "id": id, "data": "sleep 301 & echo 'jo''b='$!\n" }),
    );
    let text = output.wait_for(&id, "job=");
    let job = text
        .split("job=")
        .last()
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string();
    assert!(alive(&job));
    call(&core, "terminal_close", json!({ "id": id }));
    let start = Instant::now();
    while alive(&job) && start.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!alive(&job), "the background job {job} is still running");
}

#[test]
fn steady_output_arrives_while_it_runs() {
    let repo = TempRepo::with_commit();
    let (_data, core, events, path) = open(&repo);
    let id = session(&core, &path);
    call(
        &core,
        "terminal_write",
        json!({ "id": id, "data": "for i in 1 2 3 4 5 6; do printf tick; sleep 0.1; done; echo; echo fin\n" }),
    );
    let start = Instant::now();
    let mut before_end = 0;
    let mut text = String::new();
    while !text.contains("\nfin") {
        for event in events.take() {
            if let CoreEvent::TerminalOutput { id: from, data } = event
                && from == id
            {
                text.push_str(&data);
                if data.contains("tick") && !text.contains("\nfin") {
                    before_end += 1;
                }
            }
        }
        assert!(start.elapsed() < Duration::from_secs(10), "{text}");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(before_end >= 4, "output came in {before_end} batches");
}

#[test]
fn output_waits_for_the_screen_to_keep_up() {
    let repo = TempRepo::with_commit();
    let (_data, core, events, path) = open(&repo);
    let id = session(&core, &path);
    call(
        &core,
        "terminal_write",
        json!({ "id": id, "data": "yes 0123456789 | head -c 4000000; echo; echo fin\n" }),
    );
    let received = |events: &RecordedEvents| -> (usize, bool) {
        let mut bytes = 0;
        let mut done = false;
        for event in events.take() {
            if let CoreEvent::TerminalOutput { id: from, data } = event
                && from == id
            {
                bytes += data.len();
                done |= data.contains("\nfin");
            }
        }
        (bytes, done)
    };
    std::thread::sleep(Duration::from_millis(1000));
    let (early, _) = received(&events);
    assert!(early >= 1_000_000, "only {early} bytes arrived");
    assert!(early < 1_700_000, "{early} bytes arrived without any ack");
    call(&core, "terminal_ack", json!({ "id": id, "bytes": early }));
    let start = Instant::now();
    let mut total = early;
    loop {
        let (bytes, done) = received(&events);
        total += bytes;
        if bytes > 0 {
            call(&core, "terminal_ack", json!({ "id": id, "bytes": bytes }));
        }
        if done {
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "stuck at {total}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(total >= 4_000_000);
}
