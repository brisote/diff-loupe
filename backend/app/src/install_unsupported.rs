use std::path::{Path, PathBuf};

const UNSUPPORTED: &str = "Installing an update is not available on this system yet.";

pub fn not_installed(_image: &Path, why: &str) -> String {
    format!("Diffloupe was not updated because {why}.")
}

pub fn leftovers(_bundle: &Path) -> Vec<PathBuf> {
    Vec::new()
}

pub fn clear_leftovers(_bundle: &Path) {}

pub fn install(_image: &Path, _bundle: &Path, _reopen: bool) -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}
