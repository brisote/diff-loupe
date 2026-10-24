#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod install;
#[cfg(debug_assertions)]
mod smoke;

use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, EventSink};
use diffloupe_core::footprint;
use diffloupe_core::shellenv::ShellEnv;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct WindowEvents(AppHandle);

struct StartupError(String);

struct DataDir(PathBuf);

static LEAVING: AtomicBool = AtomicBool::new(false);

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
fn open_link(url: String) -> Result<(), String> {
    let url = diffloupe_core::update::link(&url).map_err(|e| e.to_string())?;
    let mut child = std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[tauri::command]
fn uninstall_info(app: AppHandle, data: State<'_, DataDir>) -> Result<Vec<String>, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let locations = footprint::locations(&home, &data.0, &user_dirs());
    Ok(footprint::present(&locations)
        .iter()
        .map(|path| shown(&home, path))
        .collect())
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
            locations.extend(
                app_bundle()
                    .iter()
                    .flat_map(|bundle| install::leftovers(bundle)),
            );
        }
        let system = touches_system();
        clean_up_after_exit(&locations, system.then_some(footprint::BUNDLE_ID))?;
        if let Some(core) = worker.try_state::<Arc<Core>>() {
            core.shutdown();
        }
        let _ = footprint::remove(&locations);
        Ok::<_, String>(if system { move_app_to_trash() } else { Ok(()) })
    })
    .await
    .map_err(|e| e.to_string())??;
    match trashed {
        Ok(()) => app.exit(0),
        Err(reason) => {
            let handle = app.clone();
            app.run_on_main_thread(move || {
                show_alert(
                    "Diffloupe could not move itself to the Trash",
                    &format!(
                        "Its own files are deleted. Drag Diffloupe to the Trash to finish removing it. ({reason})"
                    ),
                );
                handle.exit(0);
            })
            .map_err(|e| e.to_string())?;
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
    let bundle = app_bundle().ok_or_else(|| {
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
        install::install(&image, &bundle, true)?;
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
            Err(failed(message))
        }
    }
}

fn install_on_quit(core: &Core) {
    if LEAVING.swap(true, Ordering::SeqCst) {
        return;
    }
    if let (Some(image), Some(bundle)) = (core.update_ready(), app_bundle())
        && let Err(message) = install::install(&image, &bundle, false)
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

fn touches_system() -> bool {
    #[cfg(debug_assertions)]
    if smoke::active() {
        return false;
    }
    true
}

fn shown(home: &Path, path: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

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

#[cfg(not(target_os = "macos"))]
fn app_bundle() -> Option<PathBuf> {
    None
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

#[cfg(not(target_os = "macos"))]
fn move_app_to_trash() -> Result<(), String> {
    Ok(())
}

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
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
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
            }
            if let Some(bundle) = app_bundle() {
                install::clear_leftovers(&bundle);
            }
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
    show_alert("Diffloupe cannot start", message);
    app.exit(1);
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

#[cfg(not(target_os = "macos"))]
fn show_alert(_title: &str, _message: &str) {}

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
            uninstall_info,
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
            uninstall_info,
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
}
