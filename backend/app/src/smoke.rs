use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Manager, Webview};

const REPORT_ENV: &str = "DIFFLOUPE_SMOKE_REPORT";
const UNINSTALL_ENV: &str = "DIFFLOUPE_SMOKE_UNINSTALL";
const DATA_ENV: &str = "DIFFLOUPE_SMOKE_DATA_DIR";
const UPDATE_ENV: &str = "DIFFLOUPE_SMOKE_UPDATE";
const PACKAGE_ENV: &str = "DIFFLOUPE_SMOKE_REMOVE_PACKAGE";

const UPDATE_SCRIPT: &str = r#"
setTimeout(async () => {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const action = (text) => [...document.querySelectorAll('[role="status"] button')].find((button) => button.textContent === text);
  const report = (data) => window.__TAURI_INTERNALS__.invoke("smoke_report", { report: JSON.stringify(data) });
  for (let tries = 0; tries < 40 && !action("Update"); tries += 1) await wait(250);
  const update = action("Update");
  if (!update) return report({ phase: "after", text: document.body.innerText });
  update.click();
  for (let tries = 0; tries < 480 && !action("Restart now") && !action("Try again"); tries += 1) await wait(250);
  const restart = action("Restart now");
  if (!restart) return report({ phase: "failed", text: document.body.innerText });
  restart.click();
}, 3000);
"#;

const UNINSTALL_SCRIPT: &str = r#"
setTimeout(async () => {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const steps = [];
  const button = document.querySelector('button[aria-label="Settings menu"]');
  steps.push(`button ${!!button}`);
  button?.click();
  await wait(500);
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((row) => row.textContent.includes("Uninstall"));
  steps.push(`item ${!!item}`);
  item?.click();
  for (let tries = 0; tries < 20 && !document.querySelector('[role="dialog"][aria-label="Uninstall Diffloupe"]'); tries += 1)
    await wait(250);
  const uninstall = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Uninstall");
  steps.push(`uninstall ${!!uninstall} ${uninstall?.disabled}`);
  uninstall?.click();
  await wait(10000);
  steps.push(`alert ${document.querySelector('[role="alert"]')?.textContent ?? "none"}`);
  window.__TAURI_INTERNALS__.invoke("smoke_report", { report: JSON.stringify({ text: steps.join(" | ") }) });
}, 3000);
"#;

const SCRIPT: &str = r#"
setTimeout(async () => {
  const file = document.querySelector('[role="treeitem"][aria-level="2"]');
  if (file) {
    file.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    file.click();
    await new Promise((done) => setTimeout(done, 1500));
  }
  const terminalButton = document.querySelector('[aria-label^="Terminal "]');
  let terminal = "";
  if (terminalButton) {
    terminalButton.click();
    for (let tries = 0; tries < 8 && !terminal.trim(); tries += 1) {
      await new Promise((done) => setTimeout(done, 2000));
      terminal = document.querySelector(".app-terminal .xterm-rows")?.textContent ?? "";
    }
  }
  const icon = document.querySelector(".dl-i");
  const iconUrl = icon ? getComputedStyle(icon).backgroundImage.slice(5, -2) : "";
  const iconLoads = await new Promise((done) => {
    const image = new Image();
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = iconUrl;
  });
  await document.fonts.ready;
  const toolbar = document.querySelector("header.app-toolbar")?.getBoundingClientRect();
  const zoomedBefore = await window.__TAURI_INTERNALS__.invoke("smoke_maximized");
  if (toolbar) {
    const point = { clientX: toolbar.left + toolbar.width / 2, clientY: toolbar.top + toolbar.height / 2 };
    const target = document.elementFromPoint(point.clientX, point.clientY);
    for (const type of ["mousedown", "mouseup"])
      target?.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, detail: 2, ...point }));
    await new Promise((done) => setTimeout(done, 1000));
  }
  const zoomedAfter = await window.__TAURI_INTERNALS__.invoke("smoke_maximized");
  const report = {
    text: document.body.innerText,
    diff: document.querySelector('[aria-label="Side-by-side diff"]')?.innerText ?? "",
    keywords: document.querySelectorAll('[aria-label="Side-by-side diff"] .syn-kw').length,
    editorScroll: (() => {
      const scroller = document.querySelector(".cm-scroller");
      const content = document.querySelector(".cm-content");
      return scroller && content
        ? `${getComputedStyle(scroller).overflowY} ${getComputedStyle(content).whiteSpace}`
        : "";
    })(),
    theme: document.documentElement.dataset.theme ?? null,
    background: getComputedStyle(document.body).backgroundColor,
    interLoaded: document.fonts.check("13px Inter"),
    iconLoads,
    terminal,
    zoomed: zoomedBefore !== zoomedAfter,
    aiControls: [...document.querySelectorAll("button, [role=button], [role=menuitem], [role=option]")].filter(
      (control) => /\bAI\b/.test(`${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("title") ?? ""} ${control.textContent}`),
    ).length,
    connector: (() => {
      const path = document.querySelector('[aria-label="Side-by-side diff"] .dl-divider path');
      const block = document.querySelector('[aria-label="After"] .cm-diff-modified, [aria-label="After"] .cm-diff-inserted');
      return path && block ? path.getBoundingClientRect().top - block.getBoundingClientRect().top : null;
    })(),
  };
  window.__TAURI_INTERNALS__.invoke("smoke_report", { report: JSON.stringify(report) });
}, 3000);
"#;

pub fn active() -> bool {
    std::env::var_os(REPORT_ENV).is_some()
}

pub fn removes_package() -> bool {
    active() && std::env::var_os(PACKAGE_ENV).is_some()
}

pub fn data_dir() -> Option<std::path::PathBuf> {
    std::env::var_os(DATA_ENV)
        .filter(|_| active())
        .map(std::path::PathBuf::from)
}

pub fn on_page_load(webview: &Webview, payload: &PageLoadPayload<'_>) {
    let started = webview
        .try_state::<std::sync::Arc<diffloupe_core::Core>>()
        .is_some();
    if payload.event() == PageLoadEvent::Finished && active() && started {
        let _ = webview.window().set_focus();
        let script = if std::env::var_os(UNINSTALL_ENV).is_some() {
            UNINSTALL_SCRIPT
        } else if std::env::var_os(UPDATE_ENV).is_some() {
            UPDATE_SCRIPT
        } else {
            SCRIPT
        };
        let _ = webview.eval(script);
    }
}

#[tauri::command]
pub fn smoke_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
pub fn smoke_report(app: AppHandle, report: String) {
    if let Some(path) = std::env::var_os(REPORT_ENV) {
        let _ = std::fs::write(path, report);
        app.exit(0);
    }
}
