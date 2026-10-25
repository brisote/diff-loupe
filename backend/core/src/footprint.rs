use crate::platform::Platform;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

pub const BUNDLE_ID: &str = "com.diffloupe.app";

pub fn app_data_dir(home: &Path) -> PathBuf {
    data_dir(Platform::CURRENT, home, &|name| std::env::var(name).ok())
}

pub fn data_dir(platform: Platform, home: &Path, get: &dyn Fn(&str) -> Option<String>) -> PathBuf {
    match platform {
        Platform::Macos => home.join("Library/Application Support").join(BUNDLE_ID),
        Platform::Windows => {
            base(platform, get, "APPDATA", home.join("AppData/Roaming")).join(BUNDLE_ID)
        }
        Platform::Linux => {
            base(platform, get, "XDG_DATA_HOME", home.join(".local/share")).join(BUNDLE_ID)
        }
    }
}

fn base(
    platform: Platform,
    get: &dyn Fn(&str) -> Option<String>,
    name: &str,
    fallback: PathBuf,
) -> PathBuf {
    get(name)
        .filter(|value| absolute(platform, value))
        .map(PathBuf::from)
        .unwrap_or(fallback)
}

fn absolute(platform: Platform, path: &str) -> bool {
    match platform {
        Platform::Windows => {
            let bytes = path.as_bytes();
            path.starts_with("\\\\")
                || (bytes.len() > 2
                    && bytes[0].is_ascii_alphabetic()
                    && bytes[1] == b':'
                    && matches!(bytes[2], b'\\' | b'/'))
        }
        _ => path.starts_with('/'),
    }
}

const WEBKIT_SERVICES: [&str; 3] = ["GPU", "Networking", "WebContent"];

#[cfg(target_os = "macos")]
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

#[cfg(not(target_os = "macos"))]
pub fn user_dirs() -> Vec<PathBuf> {
    Vec::new()
}

pub fn locations(home: &Path, data_dir: &Path, user_dirs: &[PathBuf]) -> Vec<PathBuf> {
    locations_for(Platform::CURRENT, home, data_dir, user_dirs, &|name| {
        std::env::var(name).ok()
    })
}

pub fn locations_for(
    platform: Platform,
    home: &Path,
    data_dir: &Path,
    user_dirs: &[PathBuf],
    get: &dyn Fn(&str) -> Option<String>,
) -> Vec<PathBuf> {
    let mut found = vec![data_dir.to_path_buf()];
    match platform {
        Platform::Macos => found.extend(macos(home, user_dirs)),
        Platform::Windows => found
            .push(base(platform, get, "LOCALAPPDATA", home.join("AppData/Local")).join(BUNDLE_ID)),
        Platform::Linux => {
            found.push(base(platform, get, "XDG_CACHE_HOME", home.join(".cache")).join(BUNDLE_ID))
        }
    }
    found
}

fn macos(home: &Path, user_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let library = home.join("Library");
    let in_user_dirs = user_dirs.iter().flat_map(|dir| {
        std::iter::once(dir.join(BUNDLE_ID)).chain(
            WEBKIT_SERVICES
                .iter()
                .map(move |service| dir.join(format!("com.apple.WebKit.{service}+{BUNDLE_ID}"))),
        )
    });
    let mut found = vec![
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

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn every_location_is_named_by_the_bundle_id_and_stays_out_of_claude() {
        let home = Path::new("/Users/ada");
        let data = data_dir(Platform::Macos, home, &no_env);
        assert_eq!(
            data,
            Path::new("/Users/ada/Library/Application Support/com.diffloupe.app")
        );
        let user = [
            PathBuf::from("/var/folders/ab/xyz/C"),
            PathBuf::from("/var/folders/ab/xyz/T"),
        ];
        let listed = locations_for(Platform::Macos, home, &data, &user, &no_env);
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
        let data = data_dir(Platform::Macos, home, &no_env);
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
        let all = locations_for(Platform::Macos, home, &data, &user, &no_env);
        let inside: Vec<PathBuf> = all
            .iter()
            .filter(|p| p.starts_with(home))
            .cloned()
            .collect();
        assert_eq!(inside.len(), all.len() - 1);
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

    #[test]
    fn windows_keeps_its_files_in_the_roaming_and_local_folders() {
        let home = Path::new("C:\\Users\\ada");
        let env = |name: &str| match name {
            "APPDATA" => Some("D:\\Roaming".to_string()),
            _ => None,
        };
        let data = data_dir(Platform::Windows, home, &env);
        assert_eq!(data, Path::new("D:\\Roaming").join(BUNDLE_ID));
        assert_eq!(
            data_dir(Platform::Windows, home, &no_env),
            home.join("AppData/Roaming").join(BUNDLE_ID)
        );
        let listed = locations_for(Platform::Windows, home, &data, &[], &env);
        assert_eq!(
            listed,
            [data.clone(), home.join("AppData/Local").join(BUNDLE_ID)]
        );
    }

    #[test]
    fn a_relative_or_foreign_base_folder_is_ignored() {
        assert!(absolute(Platform::Windows, "C:\\Users"));
        assert!(absolute(Platform::Windows, "D:/Users"));
        assert!(absolute(Platform::Windows, "\\\\server\\share"));
        assert!(!absolute(Platform::Windows, "Users"));
        assert!(!absolute(Platform::Windows, "C:"));
        assert!(!absolute(Platform::Windows, "/home/ada"));
        assert!(absolute(Platform::Linux, "/home/ada"));
        assert!(!absolute(Platform::Linux, "home/ada"));
        assert!(!absolute(Platform::Linux, "C:\\Users"));
    }

    #[test]
    fn linux_follows_the_xdg_folders_and_ignores_relative_ones() {
        let home = Path::new("/home/ada");
        let env = |name: &str| match name {
            "XDG_DATA_HOME" => Some("/data".to_string()),
            "XDG_CACHE_HOME" => Some("relative/cache".to_string()),
            _ => None,
        };
        let data = data_dir(Platform::Linux, home, &env);
        assert_eq!(data, Path::new("/data").join(BUNDLE_ID));
        assert_eq!(
            data_dir(Platform::Linux, home, &no_env),
            Path::new("/home/ada/.local/share").join(BUNDLE_ID)
        );
        assert_eq!(
            locations_for(Platform::Linux, home, &data, &[], &env),
            [data.clone(), home.join(".cache").join(BUNDLE_ID)]
        );
    }

    #[test]
    fn every_location_on_every_platform_names_the_bundle_id_and_stays_out_of_claude() {
        let cases = [
            (Platform::Macos, Path::new("/Users/ada")),
            (Platform::Windows, Path::new("C:\\Users\\ada")),
            (Platform::Linux, Path::new("/home/ada")),
        ];
        for (platform, home) in cases {
            let data = data_dir(platform, home, &no_env);
            for location in locations_for(platform, home, &data, &[], &no_env) {
                assert!(
                    location
                        .to_string_lossy()
                        .replace('_', ".")
                        .contains(BUNDLE_ID),
                    "{platform:?} {}",
                    location.display()
                );
                assert!(!location.starts_with(home.join(".claude")));
            }
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
