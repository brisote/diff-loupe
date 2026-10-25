#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::RecordedEvents;
use diffloupe_core::platform::Platform;
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
    let os = env["os"].as_str().unwrap();
    let expected = if cfg!(target_os = "macos") {
        "macOS "
    } else if cfg!(windows) {
        "Windows "
    } else {
        ""
    };
    assert!(
        os.starts_with(expected) && os.len() > expected.len(),
        "{os}"
    );
}

#[test]
fn app_info_names_the_platform_and_a_chosen_platform_replaces_it() {
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(RecordedEvents::default())).unwrap();
    let info = core.dispatch("app_info", Value::Null).unwrap();
    assert_eq!(info["platform"], Platform::CURRENT.name());
    let other = Core::for_platform(
        data.path(),
        test_env(),
        Arc::new(RecordedEvents::default()),
        Platform::Windows,
    )
    .unwrap();
    let info = other.dispatch("app_info", Value::Null).unwrap();
    assert_eq!(info["platform"], "windows");
}
