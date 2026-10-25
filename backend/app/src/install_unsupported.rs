use std::path::{Path, PathBuf};

pub type Target = PathBuf;

const UNSUPPORTED: &str = "Installing an update is not available on this system yet.";

pub fn not_installed(_image: &Path, why: &str) -> String {
    format!("Diffloupe was not updated because {why}.")
}

pub fn install(_image: &Path, _bundle: &Path, _reopen: bool) -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}
