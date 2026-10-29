#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod install;
#[cfg(target_os = "linux")]
#[path = "install_linux.rs"]
mod install;
#[cfg(windows)]
#[path = "install_unsupported.rs"]
mod install;
#[cfg(target_os = "linux")]
mod package;
#[cfg(debug_assertions)]
mod smoke;

use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, EventSink};
use diffloupe_core::footprint;
use diffloupe_core::shellenv::ShellEnv;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::Command;
#[cfg(unix)]
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct WindowEvents(AppHandle);

struct StartupError(String);

struct DataDir(PathBuf);

static LEAVING: AtomicBool = AtomicBool::new(false);
static INSTALL_REFUSED: AtomicBool = AtomicBool::new(false);

impl EventSink for WindowEvents {
    fn emit(&self, event: CoreEvent) {
        let _ = self.0.emit("core-event", event);
    }
}

#[tauri::command]
async fn dispatch(core: State<'_, Arc<Core>>, cmd: String, args: Value) -> Result<Value, Value> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.dispatch(&cmd, args).map_err(|error| json!(error))
    })
    .await
    .map_err(|error| json!({ "code": "io", "message": error.to_string() }))?
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .ok()
        .flatten()
        .and_then(|picked| picked.into_path().ok())
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn window_control(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize(),
        "toggleMaximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        other => return Err(format!("{other} is not a window action")),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn window_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    let url = diffloupe_core::update::link(&url).map_err(|e| e.to_string())?;
    let mut child = std::process::Command::new(opener())
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(target_os = "macos")]
fn opener() -> &'static str {
    "open"
}

#[cfg(target_os = "linux")]
fn opener() -> &'static str {
    "xdg-open"
}

#[cfg(windows)]
fn opener() -> &'static str {
    "explorer.exe"
}

#[tauri::command]
async fn uninstall(app: AppHandle, data: State<'_, DataDir>) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let data_dir = data.0.clone();
    let worker = app.clone();
    LEAVING.store(true, Ordering::SeqCst);
    let trashed = tauri::async_runtime::spawn_blocking(move || {
        let mut locations = footprint::locations(&home, &data_dir, &user_dirs());
        if touches_system() {
            locations.extend(install_leftovers());
        }
        let system = touches_system();
        if removes_app()
            && remove_before_files()
            && let Err(reason) = remove_app()
        {
            LEAVING.store(false, Ordering::SeqCst);
            return Err(removal_failure(&reason));
        }
        if let Err(reason) = clean_up_after_exit(&locations, system.then_some(footprint::BUNDLE_ID))
        {
            LEAVING.store(false, Ordering::SeqCst);
            return Err(reason);
        }
        if let Some(core) = worker.try_state::<Arc<Core>>() {
            core.shutdown();
        }
        let _ = footprint::remove(&locations);
        Ok::<_, String>(if removes_app() && !remove_before_files() {
            remove_app()
        } else {
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    match trashed {
        Ok(()) => app.exit(0),
        Err(reason) => {
            let (title, message) = removal_problem(&reason);
            alert_then_exit(&app, title, &message, 0)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn install_update(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), Value> {
    let failed = |message: String| json!({ "code": "update", "message": message });
    let core = core.inner().clone();
    let image = core
        .update_ready()
        .ok_or_else(|| failed("No downloaded update is ready to install.".to_string()))?;
    let target = install_target().ok_or_else(|| {
        failed(install::not_installed(
            &image,
            "only an installed Diffloupe can update itself",
        ))
    })?;
    if LEAVING.swap(true, Ordering::SeqCst) {
        return Err(failed(
            "Diffloupe is already installing the update.".to_string(),
        ));
    }
    let installed = tauri::async_runtime::spawn_blocking(move || {
        install::install(&image, &target, true)?;
        core.shutdown();
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|installed| installed);
    match installed {
        Ok(()) => {
            app.exit(0);
            Ok(())
        }
        Err(message) => {
            LEAVING.store(false, Ordering::SeqCst);
            INSTALL_REFUSED.store(true, Ordering::SeqCst);
            Err(failed(message))
        }
    }
}

fn install_on_quit(core: &Core) {
    if LEAVING.swap(true, Ordering::SeqCst) {
        return;
    }
    if INSTALL_REFUSED.load(Ordering::SeqCst) {
        return;
    }
    if let Some(image) = core.update_ready().filter(|image| image.exists())
        && let Some(target) = install_target()
        && let Err(message) = install::install(&image, &target, false)
    {
        let downloads = core.updates_dir();
        let _ = std::fs::create_dir_all(&downloads);
        let _ = std::fs::write(downloads.join("failed"), format!("{message}\n"));
    }
}

fn user_dirs() -> Vec<PathBuf> {
    if touches_system() {
        footprint::user_dirs()
    } else {
        Vec::new()
    }
}

fn removes_app() -> bool {
    #[cfg(debug_assertions)]
    if smoke::removes_package() {
        return true;
    }
    touches_system()
}

fn touches_system() -> bool {
    #[cfg(debug_assertions)]
    if smoke::active() {
        return false;
    }
    true
}

#[cfg(windows)]
fn clean_up_after_exit(locations: &[PathBuf], _defaults: Option<&str>) -> Result<(), String> {
    if locations.is_empty() {
        return Ok(());
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let pid = std::process::id();
    let paths: Vec<String> = locations
        .iter()
        .map(|p| format!("'{}'", p.display().to_string().replace('\'', "''")))
        .collect();
    let joined = paths.join(",");
    let script = format!(
        "$p = Get-Process -Id {pid} -ErrorAction SilentlyContinue; if ($p) {{ $p.WaitForExit(10000) }}; @({joined}) | ForEach-Object {{ if (Test-Path $_) {{ Remove-Item -Recurse -Force $_ -ErrorAction SilentlyContinue }} }}"
    );
    Command::new("powershell.exe")
        .args([
            "-ExecutionPolicy",
            "Bypass",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(not(any(unix, windows)))]
fn clean_up_after_exit(_locations: &[PathBuf], _defaults: Option<&str>) -> Result<(), String> {
    Err("Uninstall is not available on this system yet.".to_string())
}

#[cfg(unix)]
fn clean_up_after_exit(locations: &[PathBuf], defaults: Option<&str>) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    Command::new("/bin/sh")
        .arg("-c")
        .arg(
            r#"domain=$1; pid=$2; shift 2
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
for pass in 1 2; do
  sleep 3
  pgrep -x diffloupe >/dev/null && exit 0
  [ -n "$domain" ] && /usr/bin/defaults delete "$domain" >/dev/null 2>&1
  rm -rf -- "$@"
done"#,
        )
        .arg("diffloupe-uninstall")
        .arg(defaults.unwrap_or(""))
        .arg(std::process::id().to_string())
        .args(locations)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn install_target() -> Option<install::Target> {
    app_bundle()
}

#[cfg(target_os = "linux")]
fn install_target() -> Option<install::Target> {
    package::installed()
}

#[cfg(windows)]
fn install_target() -> Option<install::Target> {
    None
}

#[cfg(target_os = "macos")]
fn install_leftovers() -> Vec<PathBuf> {
    app_bundle()
        .iter()
        .flat_map(|bundle| install::leftovers(bundle))
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn install_leftovers() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn clear_install_leftovers() {
    if let Some(bundle) = app_bundle() {
        install::clear_leftovers(&bundle);
    }
}

#[cfg(not(target_os = "macos"))]
fn clear_install_leftovers() {}

#[cfg(target_os = "macos")]
fn app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app")
        .then(|| bundle.to_path_buf())
}

#[cfg(target_os = "macos")]
fn move_app_to_trash() -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let Some(bundle) = app_bundle() else {
        return Ok(());
    };
    let url = NSURL::fileURLWithPath(&NSString::from_str(&bundle.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}

#[cfg(target_os = "macos")]
fn remove_app() -> Result<(), String> {
    move_app_to_trash()
}

#[cfg(target_os = "linux")]
fn remove_app() -> Result<(), String> {
    package::remove()
}

#[cfg(any(windows, test))]
fn uninstaller_at(exe: &std::path::Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    let uninstaller = dir.join("uninstall.exe");
    uninstaller.exists().then_some(uninstaller)
}

#[cfg(windows)]
fn installed() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    uninstaller_at(&exe)
}

#[cfg(windows)]
fn remove_app() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let Some(uninstaller) = installed() else {
        return Ok(());
    };
    let pid = std::process::id();
    let uninstaller_path = uninstaller.display().to_string().replace('\'', "''");
    let script = format!(
        "$p = Get-Process -Id {pid} -ErrorAction SilentlyContinue; if ($p) {{ $p.WaitForExit(30000) }}; Start-Process -FilePath '{uninstaller_path}' -ArgumentList '/S' -Wait"
    );
    Command::new("powershell.exe")
        .args([
            "-ExecutionPolicy",
            "Bypass",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn remove_before_files() -> bool {
    true
}

#[cfg(not(target_os = "linux"))]
fn remove_before_files() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn removal_failure(reason: &str) -> String {
    package::failure(reason)
}

#[cfg(not(target_os = "linux"))]
fn removal_failure(reason: &str) -> String {
    removal_problem(reason).1
}

#[cfg(target_os = "macos")]
fn removal_problem(reason: &str) -> (&'static str, String) {
    (
        "Diffloupe could not move itself to the Trash",
        format!(
            "Its own files are deleted. Drag Diffloupe to the Trash to finish removing it. ({reason})"
        ),
    )
}

#[cfg(target_os = "linux")]
fn removal_problem(reason: &str) -> (&'static str, String) {
    (
        "Diffloupe could not remove itself",
        package::failure(reason),
    )
}

#[cfg(windows)]
fn removal_problem(reason: &str) -> (&'static str, String) {
    (
        "Diffloupe could not remove itself",
        format!(
            "Its own files are deleted. Remove Diffloupe in Windows' Installed apps list. ({reason})"
        ),
    )
}

#[cfg(windows)]
fn watch_maximized(window: &tauri::WebviewWindow) {
    let watched = window.clone();
    let last = AtomicBool::new(false);
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Resized(_) = event {
            let now = watched.is_maximized().unwrap_or(false);
            if last.swap(now, Ordering::SeqCst) != now {
                let _ = watched.emit("window-maximized", now);
            }
        }
    });
}

#[cfg(not(windows))]
fn watch_maximized(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "macos")]
fn keep_out_of_window_restoration(window: &tauri::WebviewWindow) {
    if let Ok(pointer) = window.ns_window() {
        let ns_window = unsafe { &*pointer.cast::<objc2_app_kit::NSWindow>() };
        ns_window.setRestorable(false);
    }
}

#[cfg(not(target_os = "macos"))]
fn keep_out_of_window_restoration(_window: &tauri::WebviewWindow) {}

fn main() {
    let mut builder = tauri::Builder::default();
    if touches_system() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation")
                .on_navigation(|_, url| app_page(url))
                .build(),
        )
        .setup(|app| {
            let home = app.path().home_dir()?;
            let events = Arc::new(WindowEvents(app.handle().clone()));
            if let Some(window) = app.get_webview_window("main") {
                keep_out_of_window_restoration(&window);
                watch_maximized(&window);
            }
            clear_install_leftovers();
            let data_dir = footprint::app_data_dir(&home);
            #[cfg(debug_assertions)]
            let data_dir = smoke::data_dir().unwrap_or(data_dir);
            match Core::new(&data_dir, ShellEnv::detect(), events) {
                Ok(core) => {
                    app.manage(Arc::new(core));
                }
                Err(error) => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    app.manage(StartupError(error.to_string()));
                }
            }
            app.manage(DataDir(data_dir));
            Ok(())
        })
        .on_page_load(page_loaded)
        .register_commands()
        .build(tauri::generate_context!())
        .expect("Diffloupe could not start")
        .run(|app, event| {
            if let tauri::RunEvent::Ready = event
                && let Some(error) = app.try_state::<StartupError>()
            {
                cannot_start(app, &error.0);
            }
            if let tauri::RunEvent::Exit = event
                && let Some(core) = app.try_state::<Arc<Core>>()
            {
                core.shutdown();
                install_on_quit(&core);
            }
        });
}

fn cannot_start(app: &AppHandle, message: &str) {
    eprintln!("Diffloupe cannot start: {message}");
    let _ = alert_then_exit(app, "Diffloupe cannot start", message, 1);
}

#[cfg(target_os = "macos")]
fn alert_then_exit(app: &AppHandle, title: &str, message: &str, code: i32) -> Result<(), String> {
    let handle = app.clone();
    let (title, message) = (title.to_string(), message.to_string());
    app.run_on_main_thread(move || {
        show_alert(&title, &message);
        handle.exit(code);
    })
    .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn alert_then_exit(app: &AppHandle, title: &str, message: &str, code: i32) -> Result<(), String> {
    show_alert(title, message);
    app.exit(code);
    Ok(())
}

#[cfg(target_os = "linux")]
fn alert_then_exit(app: &AppHandle, title: &str, message: &str, code: i32) -> Result<(), String> {
    use tauri_plugin_dialog::MessageDialogKind;
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(code));
    Ok(())
}

#[cfg(target_os = "macos")]
fn show_alert(title: &str, message: &str) {
    use objc2_app_kit::{NSAlert, NSAlertStyle};
    use objc2_foundation::{MainThreadMarker, NSString};
    let Some(main_thread) = MainThreadMarker::new() else {
        return;
    };
    let alert = NSAlert::new(main_thread);
    alert.setAlertStyle(NSAlertStyle::Critical);
    alert.setMessageText(&NSString::from_str(title));
    alert.setInformativeText(&NSString::from_str(message));
    alert.runModal();
}

#[cfg(windows)]
fn show_alert(title: &str, message: &str) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};

    let title: Vec<u16> = std::ffi::OsStr::new(title)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let message: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

fn page_loaded(webview: &tauri::Webview, payload: &PageLoadPayload<'_>) {
    if payload.event() == PageLoadEvent::Finished {
        eprintln!("Diffloupe page loaded");
    }
    #[cfg(debug_assertions)]
    smoke::on_page_load(webview, payload);
    #[cfg(not(debug_assertions))]
    let _ = webview;
}

fn app_page(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions) && url.host_str() == Some("localhost"))
        }
        _ => false,
    }
}

trait RegisterCommands {
    fn register_commands(self) -> Self;
}

impl RegisterCommands for tauri::Builder<tauri::Wry> {
    #[cfg(debug_assertions)]
    fn register_commands(self) -> Self {
        self.invoke_handler(tauri::generate_handler![
            dispatch,
            pick_folder,
            open_link,
            window_control,
            window_maximized,
            uninstall,
            install_update,
            smoke::smoke_report,
            smoke::smoke_maximized
        ])
    }

    #[cfg(not(debug_assertions))]
    fn register_commands(self) -> Self {
        self.invoke_handler(tauri::generate_handler![
            dispatch,
            pick_folder,
            open_link,
            window_control,
            window_maximized,
            uninstall,
            install_update
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::app_page;

    fn page(url: &str) -> bool {
        app_page(&tauri::Url::parse(url).unwrap_or_else(|_| panic!("bad url {url}")))
    }

    #[test]
    fn only_the_app_itself_may_load_in_the_window() {
        assert!(page("tauri://localhost/index.html"));
        assert!(page("http://tauri.localhost/"));
        assert!(!page("https://attacker.example/"));
        assert!(!page("file:///etc/passwd"));
        assert!(!page("javascript:alert(1)"));
    }

    #[test]
    fn uninstaller_detects_uninstall_exe_in_the_same_directory() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("diffloupe.exe");
        assert_eq!(super::uninstaller_at(&exe), None);
        let uninstaller = dir.path().join("uninstall.exe");
        std::fs::write(&uninstaller, b"fake").unwrap();
        assert_eq!(super::uninstaller_at(&exe), Some(uninstaller));
    }
}
