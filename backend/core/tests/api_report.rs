#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::RecordedEvents;
use diffloupe_core::testutil::test_env;
use serde_json::Value;
use std::sync::Arc;

#[test]
fn the_report_names_the_app_the_system_and_git() {
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(RecordedEvents::default())).unwrap();
    let env = core.dispatch("report_env", Value::Null).unwrap();
    assert_eq!(env["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(env["arch"], std::env::consts::ARCH);
    let git = env["git"].as_str().unwrap();
    assert!(git.starts_with(|c: char| c.is_ascii_digit()), "{git}");
    if cfg!(target_os = "macos") {
        assert!(
            env["macos"]
                .as_str()
                .unwrap()
                .starts_with(|c: char| c.is_ascii_digit())
        );
    }
}
