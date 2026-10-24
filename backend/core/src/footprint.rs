use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const BUNDLE_ID: &str = "com.diffloupe.app";

pub fn app_data_dir(home: &Path) -> PathBuf {
    home.join("Library/Application Support").join(BUNDLE_ID)
}

const WEBKIT_SERVICES: [&str; 3] = ["GPU", "Networking", "WebContent"];

pub fn user_dirs() -> Vec<PathBuf> {
    ["DARWIN_USER_CACHE_DIR", "DARWIN_USER_TEMP_DIR"]
        .into_iter()
        .filter_map(|name| {
            let output = Command::new("/usr/bin/getconf").arg(name).output().ok()?;
            let dir = String::from_utf8(output.stdout).ok()?;
            let dir = dir.trim();
            (output.status.success() && !dir.is_empty()).then(|| PathBuf::from(dir))
        })
        .collect()
}

pub fn locations(home: &Path, data_dir: &Path, user_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let library = home.join("Library");
    let in_user_dirs = user_dirs.iter().flat_map(|dir| {
        std::iter::once(dir.join(BUNDLE_ID)).chain(
            WEBKIT_SERVICES
                .iter()
                .map(move |service| dir.join(format!("com.apple.WebKit.{service}+{BUNDLE_ID}"))),
        )
    });
    let mut found = vec![
        data_dir.to_path_buf(),
        library.join("Caches").join(BUNDLE_ID),
        library
            .join("Preferences")
            .join(format!("{BUNDLE_ID}.plist")),
        library
            .join("Saved Application State")
            .join(format!("{BUNDLE_ID}.savedState")),
        library.join("WebKit").join(BUNDLE_ID),
        library.join("HTTPStorages").join(BUNDLE_ID),
        library
            .join("HTTPStorages")
            .join(format!("{BUNDLE_ID}.binarycookies")),
        library.join("Logs").join(BUNDLE_ID),
        single_instance_socket(),
    ];
    found.extend(in_user_dirs);
    found
}

pub fn single_instance_socket() -> PathBuf {
    PathBuf::from(format!("/tmp/{}_si.sock", BUNDLE_ID.replace('.', "_")))
}

pub fn present(locations: &[PathBuf]) -> Vec<PathBuf> {
    locations
        .iter()
        .filter(|location| location.symlink_metadata().is_ok())
        .cloned()
        .collect()
}

pub fn remove(locations: &[PathBuf]) -> Result<(), String> {
    let failed: Vec<String> = present(locations)
        .into_iter()
        .filter_map(|location| {
            let removed = match location.symlink_metadata() {
                Ok(meta) if meta.is_dir() => fs::remove_dir_all(&location),
                Ok(_) => fs::remove_file(&location),
                Err(_) => Ok(()),
            };
            removed
                .err()
                .map(|e| format!("{} ({e})", location.display()))
        })
        .collect();
    if failed.is_empty() {
        Ok(())
    } else {
        Err(format!("Diffloupe could not delete {}", failed.join(", ")))
    }
}

pub fn owns(home: &Path, data_dir: &Path, candidate: &Path) -> bool {
    locations(home, data_dir, &[])
        .iter()
        .any(|l| candidate.starts_with(l))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_location_is_named_by_the_bundle_id_and_stays_out_of_claude() {
        let home = Path::new("/Users/ada");
        let data = app_data_dir(home);
        assert_eq!(
            data,
            Path::new("/Users/ada/Library/Application Support/com.diffloupe.app")
        );
        let user = [
            PathBuf::from("/var/folders/ab/xyz/C"),
            PathBuf::from("/var/folders/ab/xyz/T"),
        ];
        let listed = locations(home, &data, &user);
        assert!(listed.contains(&PathBuf::from(
            "/var/folders/ab/xyz/C/com.apple.WebKit.WebContent+com.diffloupe.app"
        )));
        for location in listed {
            let named = location.to_string_lossy().replace('_', ".");
            assert!(named.contains(BUNDLE_ID), "{}", location.display());
            assert!(!location.starts_with(home.join(".claude")));
        }
        assert_eq!(
            single_instance_socket(),
            Path::new("/tmp/com_diffloupe_app_si.sock")
        );
    }

    #[test]
    fn remove_deletes_the_listed_locations_and_nothing_else() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let data = app_data_dir(home);
        let library = home.join("Library");
        fs::create_dir_all(data.join("backups/2026-10-22-120000-from-0.1.0")).unwrap();
        fs::write(data.join("state.db"), "x").unwrap();
        fs::create_dir_all(library.join("Caches").join(BUNDLE_ID)).unwrap();
        fs::create_dir_all(library.join("Preferences")).unwrap();
        fs::write(
            library
                .join("Preferences")
                .join(format!("{BUNDLE_ID}.plist")),
            "x",
        )
        .unwrap();
        let user = [home.join("var/C"), home.join("var/T")];
        fs::create_dir_all(user[0].join(BUNDLE_ID)).unwrap();
        fs::create_dir_all(user[1].join(format!("com.apple.WebKit.Networking+{BUNDLE_ID}")))
            .unwrap();
        let kept = [
            home.join(".claude/projects/acme/session.jsonl"),
            user[0].join("com.apple.WebKit.GPU+diffloupe-086f6fa5ed666937/cache"),
            user[0].join("com.other.app/cache"),
            library.join("Caches/com.other.app/cache"),
            library.join("Preferences/com.other.app.plist"),
            library.join("Application Support/com.diffloupe.app.other/note"),
        ];
        for path in &kept {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "keep").unwrap();
        }
        let inside: Vec<PathBuf> = locations(home, &data, &user)
            .into_iter()
            .filter(|p| p.starts_with(home))
            .collect();
        assert_eq!(inside.len(), locations(home, &data, &user).len() - 1);
        assert_eq!(
            present(&inside),
            [
                data.clone(),
                library.join("Caches").join(BUNDLE_ID),
                library
                    .join("Preferences")
                    .join(format!("{BUNDLE_ID}.plist")),
                user[0].join(BUNDLE_ID),
                user[1].join(format!("com.apple.WebKit.Networking+{BUNDLE_ID}")),
            ]
        );
        remove(&inside).unwrap();
        assert!(present(&inside).is_empty());
        for path in &kept {
            assert_eq!(
                fs::read_to_string(path).unwrap(),
                "keep",
                "{}",
                path.display()
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn user_dirs_are_the_per_user_cache_and_temp_folders() {
        let dirs = user_dirs();
        assert_eq!(dirs.len(), 2);
        assert!(dirs[0].ends_with("C"), "{}", dirs[0].display());
        assert!(dirs[1].ends_with("T"), "{}", dirs[1].display());
        assert!(dirs.iter().all(|dir| dir.is_dir()));
    }

    #[test]
    fn owns_files_inside_the_listed_folders_only() {
        let home = Path::new("/Users/ada");
        let data = app_data_dir(home);
        assert!(owns(home, &data, &data.join("state.db")));
        assert!(owns(
            home,
            &data,
            &data.join("backups/2026-10-22-120000-from-0.1.0/state.db")
        ));
        assert!(!owns(
            home,
            &data,
            Path::new("/Users/ada/.claude/projects/x.jsonl")
        ));
        assert!(!owns(
            home,
            &data,
            Path::new("/Users/ada/Library/Caches/com.other.app")
        ));
    }
}
