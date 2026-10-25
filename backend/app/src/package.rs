use diffloupe_core::update::PackageKind;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    pub kind: PackageKind,
    pub name: String,
}

fn executable() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let text = exe.to_string_lossy();
    Some(PathBuf::from(
        text.strip_suffix(" (deleted)").unwrap_or(&text),
    ))
}

fn query(program: &str, args: &[&str], exe: &PathBuf) -> Option<String> {
    let output = Command::new(program)
        .args(args)
        .arg(exe)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn dpkg_owner(output: &str) -> Option<String> {
    let name = output.lines().next()?.split(": ").next()?;
    let name = name.split(',').next()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

pub fn rpm_owner(output: &str) -> Option<String> {
    let name = output.lines().next()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

pub fn installed() -> Option<Owner> {
    let exe = executable()?;
    if let Some(name) = query("dpkg", &["-S"], &exe).and_then(|out| dpkg_owner(&out)) {
        return Some(Owner {
            kind: PackageKind::Deb,
            name,
        });
    }
    query("rpm", &["-qf", "--qf", "%{NAME}"], &exe)
        .and_then(|out| rpm_owner(&out))
        .map(|name| Owner {
            kind: PackageKind::Rpm,
            name,
        })
}

pub fn removal(owner: &Owner) -> Vec<String> {
    let manager: &[&str] = match owner.kind {
        PackageKind::Rpm => &["dnf", "remove", "-y"],
        _ => &["apt-get", "remove", "-y"],
    };
    ["pkexec"]
        .into_iter()
        .chain(manager.iter().copied())
        .chain([owner.name.as_str()])
        .map(str::to_string)
        .collect()
}

pub fn by_hand(owner: &Owner) -> String {
    match owner.kind {
        PackageKind::Rpm => format!("sudo dnf remove {}", owner.name),
        _ => format!("sudo apt remove {}", owner.name),
    }
}

pub fn failure(reason: &str) -> String {
    let command = installed().map_or_else(
        || "your package manager".to_string(),
        |owner| format!("`{}`", by_hand(&owner)),
    );
    format!(
        "Diffloupe could not remove its package, so nothing was deleted. Try again, or remove it with {command}. ({reason})"
    )
}

fn last_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .map(str::to_string)
}

pub fn remove() -> Result<(), String> {
    let Some(owner) = installed() else {
        return Ok(());
    };
    let command = removal(&owner);
    let output = Command::new(&command[0])
        .args(&command[1..])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("{} could not start: {e}", command[0]))?;
    if output.status.success() {
        return Ok(());
    }
    let said = last_line(&String::from_utf8_lossy(&output.stderr))
        .or_else(|| last_line(&String::from_utf8_lossy(&output.stdout)));
    Err(said.unwrap_or_else(|| "the package manager did not remove it".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(kind: PackageKind) -> Owner {
        Owner {
            kind,
            name: "diffloupe".to_string(),
        }
    }

    #[test]
    fn a_deb_is_removed_with_apt_and_an_rpm_with_dnf_both_through_pkexec() {
        assert_eq!(
            removal(&owner(PackageKind::Deb)),
            ["pkexec", "apt-get", "remove", "-y", "diffloupe"]
        );
        assert_eq!(
            removal(&owner(PackageKind::Rpm)),
            ["pkexec", "dnf", "remove", "-y", "diffloupe"]
        );
    }

    #[test]
    fn the_package_to_remove_is_the_one_that_owns_the_program() {
        let other = Owner {
            kind: PackageKind::Deb,
            name: "diffloupe-beta".to_string(),
        };
        assert_eq!(
            removal(&other).last().map(String::as_str),
            Some("diffloupe-beta")
        );
        assert_eq!(by_hand(&other), "sudo apt remove diffloupe-beta");
    }

    #[test]
    fn the_command_to_run_by_hand_names_the_package() {
        assert_eq!(
            by_hand(&owner(PackageKind::Deb)),
            "sudo apt remove diffloupe"
        );
        assert_eq!(
            by_hand(&owner(PackageKind::Rpm)),
            "sudo dnf remove diffloupe"
        );
    }

    #[test]
    fn the_owner_is_read_from_what_dpkg_and_rpm_print() {
        assert_eq!(
            dpkg_owner("diffloupe: /usr/bin/diffloupe\n").as_deref(),
            Some("diffloupe")
        );
        assert_eq!(
            dpkg_owner("diffloupe, helper: /usr/bin/diffloupe\n").as_deref(),
            Some("diffloupe")
        );
        assert_eq!(dpkg_owner(""), None);
        assert_eq!(rpm_owner("diffloupe\n").as_deref(), Some("diffloupe"));
        assert_eq!(rpm_owner("\n"), None);
    }

    #[test]
    fn a_failure_says_nothing_was_deleted_and_names_a_way_out() {
        let text = failure("pkexec could not start");
        assert!(text.contains("nothing was deleted"));
        assert!(text.contains("pkexec could not start"));
        assert!(text.contains("your package manager"));
    }

    #[test]
    fn the_last_line_of_the_package_manager_is_the_reason() {
        assert_eq!(
            last_line("Reading lists\nE: Could not get lock\n\n").as_deref(),
            Some("E: Could not get lock")
        );
        assert_eq!(last_line("\n  \n"), None);
    }

    #[test]
    fn a_program_that_is_not_installed_by_a_package_manager_removes_nothing() {
        assert_eq!(installed(), None);
        assert_eq!(remove(), Ok(()));
    }
}
