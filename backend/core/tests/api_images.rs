#![allow(clippy::unwrap_used)]

use diffloupe_core::Core;
use diffloupe_core::events::NoEvents;
use diffloupe_core::testutil::{TempRepo, test_env};
use serde_json::{Value, json};
use std::sync::Arc;

fn image(core: &Core, path: &Value, source: &str, rev: Option<&str>) -> Value {
    core.dispatch(
        "read_image",
        json!({ "path": path, "document": "docs/guide.md", "source": source, "rev": rev }),
    )
    .unwrap()
}

#[test]
fn images_load_from_the_revision_or_the_working_tree() {
    let repo = TempRepo::with_commit();
    repo.write("docs/img/shot.png", "old");
    repo.commit_all("Add a screenshot");
    repo.write("docs/img/shot.png", "new");
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.png"), "secret").unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("secret.png"),
        repo.path().join("docs/link.png"),
    )
    .unwrap();
    let data = tempfile::tempdir().unwrap();
    let core = Core::new(data.path(), test_env(), Arc::new(NoEvents)).unwrap();
    let path = core
        .dispatch("open_repo", json!({ "path": repo.path() }))
        .unwrap()["path"]
        .clone();
    assert_eq!(
        image(&core, &path, "img/shot.png", Some("HEAD")),
        "data:image/png;base64,b2xk"
    );
    assert_eq!(
        image(&core, &path, "img/shot.png", None),
        "data:image/png;base64,bmV3"
    );
    assert_eq!(image(&core, &path, "img/missing.png", None), Value::Null);
    assert_eq!(
        image(&core, &path, "../../../etc/hosts.png", None),
        Value::Null
    );
    assert_eq!(image(&core, &path, "link.png", None), Value::Null);
    assert_eq!(
        image(&core, &path, "https://example.com/a.png", None),
        Value::Null
    );
    assert_eq!(
        image(&core, &path, "../README.md", Some("HEAD")),
        Value::Null
    );
}
