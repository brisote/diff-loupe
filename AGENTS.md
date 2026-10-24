# AGENTS.md

Rules for every agent and person who changes Diffloupe. Follow them on every change, so the code stays consistent.

## What Diffloupe is

A macOS desktop app for reviewing git changes, built with Tauri 2: a Rust core and a React + TypeScript UI in the system WebView. Its look is a calm, IDE-style interface of rounded panels on a quiet background, with a branch-only commit history and rendered Markdown diffs. There is no server and no command-line interface: Diffloupe is used only through its window.

## Layout

The top level holds three folders and the files they share: `AGENTS.md` (with `CLAUDE.md`, which points to it), the files GitHub shows to visitors (`README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`), `CHANGELOG.md`, `NOTICE`, the pnpm workspace (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`), `biome.json`, `rust-toolchain.toml`, `.cargo/` and `.github/`, which also holds the issue and pull request templates. Add new files inside one of the three folders.

Diffloupe's own code is under the PolyForm Internal Use License 1.0.0 in `LICENSE`. Every bundled third-party file keeps its own license: list it in `NOTICE`, keep its copyright header, and keep its license text in the repository, beside the files (as `frontend/src/assets/icons/LICENSE` and the `*-OFL.txt` files in the font folders do) or in `NOTICE`. The app ships these texts in its bundle through `bundle.resources` in `backend/app/tauri.conf.json`; add a new one there too.

| Path                              | What it holds                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `backend/`                        | The Cargo workspace (`Cargo.toml`, `Cargo.lock`, `clippy.toml`). Its build output goes to `backend/target/`.                   |
| `backend/core/`                   | `diffloupe-core`, a Rust library with all logic: git, diffs, store, file watching. It knows nothing about Tauri.               |
| `backend/devbridge/`              | `diffloupe-devbridge`, a binary that serves the core over a local WebSocket, so the UI runs in a browser for tests.            |
| `backend/app/`                    | The Tauri app: a thin shell that passes messages between the UI and the core, plus native dialogs.                             |
| `backend/scripts/`                | Python helpers that build, run and check the app: dev bridge, smoke test, release check, type export, demo repositories.        |
| `frontend/`                       | The UI package: `package.json`, Vite, Vitest, Playwright and TypeScript configs, `index.html` and pnpm `patches/`.            |
| `frontend/src/`                   | The React UI.                                                                                                                  |
| `frontend/src/api/`               | The only place the UI talks to the core. `generated/` holds TypeScript types exported from the core; never edit it by hand.    |
| `frontend/src/styles/`            | Design tokens and component CSS from the frozen design system.                                                                 |
| `frontend/e2e/`                   | Playwright UI tests that drive the real UI through the dev bridge.                                                             |
| `website/`                        | The public site at diffloupe.com: an Astro project with its own pnpm lockfile. `src/assets/screens/` holds the app screenshots it uses, with their `manifest.json`. |
| `website/scripts/`                | `capture_screens.py` takes those screenshots from the real UI through the dev bridge; `sync_design.py` writes the site's stylesheet from the frozen site boards; `make_fonts.py` writes the web fonts; `check_links.py` checks the built site's links; `install_check.py` installs a release build with `install.sh` on the Mac. |

The frozen design lives in the private repository `brisote/diffloupe-design`: the design system, the prototype screens and the site boards. It is the visual reference; never change it to match the code. Check it out next to this repository, as `../diffloupe-design`, or point `DIFFLOUPE_DESIGN_DIR` at it. The generated files the build needs stay here: the stylesheets and icons in `frontend/src/styles/` and `frontend/src/assets/icons/`, and the site's `src/styles/site.css` and screenshots. Its `scripts/` render the frozen screens and boards; its `scripts/sync_design.py` rewrites `frontend/src/styles/` and the icon rules from the design system. They find this checkout next to theirs, or in `DIFFLOUPE_APP_DIR`. Contributors without access to the design repository run every gate except the design comparison: set `CI=1` for the site's `pnpm e2e` and its Python tests, and a maintainer runs the comparison before merging.

## Commands

Run `pnpm` commands from the top level. Run `cargo` commands from `backend/`, and Playwright or Vitest commands from `frontend/`.

```bash
pnpm install
pnpm dev          # Tauri app with hot reload
pnpm dev:bridge   # dev bridge + Vite, open the printed URL in a browser
pnpm build        # UI build into frontend/dist/
pnpm test         # cargo test --workspace, then Vitest
pnpm e2e          # Playwright through the dev bridge
pnpm lint         # cargo fmt --check, clippy -D warnings, Biome, tsc
pnpm format       # cargo fmt and Biome write
pnpm types        # regenerate frontend/src/api/generated from the Rust types
python3 -m unittest discover -s backend/scripts/tests -t backend/scripts/tests   # tests of the Python helpers
python3 -m unittest discover -s website/scripts/tests -t website/scripts/tests   # tests of the website's Python helpers
python3 backend/scripts/release_check.py      # checks a release and builds its .dmg, as the Release workflow does
```

Run `pnpm lint`, `pnpm test` and `pnpm e2e` before every commit that is meant to be merged. All three must pass.

Checks that need a Mac, which CI cannot run:

```bash
python3 backend/scripts/app_smoke.py           # starts the real app and checks what its window shows
python3 backend/scripts/update_check.py        # updates a copy of the debug build to a local test release, and keeps it on a wrong checksum
python3 backend/scripts/start_time.py          # times five starts of the release build (`pnpm tauri build`) from launch to its first page
python3 backend/scripts/footprint_check.py before   # then use the app, quit it, and run "after"
python3 ../diffloupe-design/scripts/render_design.py Main   # renders frozen screens to frontend/target/design-renders/
python3 ../diffloupe-design/scripts/render_site.py          # renders the frozen site boards to frontend/target/site-design-renders/
python3 website/scripts/capture_screens.py   # the site's app screenshots, at double resolution, to website/src/assets/screens/
python3 website/scripts/install_check.py      # installs the newest release .dmg with install.sh into a temporary folder and starts the copy
uv run --with pillow python backend/scripts/make_icon.py backend/app/app-icon.png   # redraws the app icon; then `pnpm tauri icon backend/app/app-icon.png -o backend/target/icons` and copy the files listed in bundle.icon of backend/app/tauri.conf.json into backend/app/icons/
python3 backend/scripts/perf_repo.py ~/perf/vscode   # prepares a clone of microsoft/vscode for the speed checks
```

From `frontend/`:

```bash
DL_SCREENS=1 pnpm playwright test e2e/screens.spec.ts   # app screenshots to frontend/target/screens/
DL_PERF_REPO=~/perf/vscode pnpm playwright test e2e/release-perf.spec.ts --project=perf --no-deps   # times the UI against the speed targets
```

From `backend/`:

```bash
DIFFLOUPE_PERF_REPO=~/perf/vscode cargo test -p diffloupe-core --test perf_repo -- --nocapture   # times the core commands
```

`app_smoke.py` runs the app with its store in temporary folders. The checks started like Finder use your real home, so that your login shell's PATH applies; WebKit's caches for `com.diffloupe.app` in the per-user cache folder are shared with an installed Diffloupe in every run. `app_smoke.py` brings its window to the front, because macOS slows down and stops painting a window in the background; leave the keyboard alone while it runs. Run `app_smoke.py` when a change touches `backend/app/`, the content security policy or how assets load. The scroll test in `frontend/e2e/perf.spec.ts` checks frame times only outside CI, because the Linux runner renders WebKit in software. On CI it checks only that the diff keeps a bounded number of lines in the page, so run `pnpm e2e` on the Mac before merging a change to the diff views. Compare `frontend/target/screens/` with `frontend/target/design-renders/` for every screen a change touches, in light and dark. Run the two speed checks on the prepared vscode clone before a release and after a change to the diff views, the Changes list or the branch log; each prints every target with its measured time.

## Website

The site lives in `website/`, its own pnpm project outside the app's workspace; run its commands from there. Use Node 22 and Python 3.

```bash
pnpm install                 # the site's packages, from website/pnpm-lock.yaml
pnpm dev                     # the site at http://localhost:4321
pnpm build                   # the static site in website/dist/
pnpm lint                    # Biome and tsc
pnpm test                    # Vitest
pnpm links                   # every internal link, asset and anchor in dist/ resolves
pnpm e2e                     # Playwright on the built site: Chromium and WebKit, 1440 and 390 px, light and dark, and once without JavaScript
python3 scripts/sync_design.py   # rewrites src/styles/site.css after a change to the frozen site.css
```

- **Match the frozen site boards.** Pages reuse the frozen design's classes from `src/styles/site.css`, which `sync_design.py` writes; never edit that file by hand. The design comparison in `e2e/design.spec.ts` renders each frozen board next to the built page in the same browser and fails above the recorded tolerance. It masks the app screenshots, whose compressed copies differ from the board's PNG by noise alone, and checks instead that each slot shows the same scene as the board; its images go to `website/target/design-diff/`. It reads the boards from the private design checkout, so it runs on the Mac only: without the checkout it fails locally and is skipped when `CI` is set, as are the stylesheet checks in `scripts/tests/`.
- **Nothing from another origin.** Fonts, styles, scripts and images come from the site itself, every page carries a content security policy for its own origin only, and pages set no cookies. `e2e/origin.spec.ts` enforces it. Never use inline styles or inline scripts, because the policy blocks them.
- **Screenshots through the manifest.** Show an app screenshot only with `src/components/Shot.astro` and a scene from `src/assets/screens/manifest.json`. It serves a light and a dark source in AVIF and WebP; `tests/screens.test.ts` fails when a scene is missing or unused.
- **Changelog from its source.** `src/lib/changelog.ts` renders the `CHANGELOG.md` sections of the versions that have a release. Local builds and tests read `src/data/changelog.fixture.md` and the fixture's release list instead, so the pages always match the frozen boards; `DIFFLOUPE_RELEASE=live` reads the real ones.
- **Release facts from one module.** The Download page and `/install.sh` take the version, date, size, link and checksum from `src/lib/release.ts`. Local builds and tests read `src/data/release.fixture.json`; `DIFFLOUPE_RELEASE=live` reads every release of `brisote/diff-loupe` from GitHub, with `GITHUB_TOKEN` when it is set, and fails when a value is missing. The latest release is the highest version, so the Download page, the Changelog and the script always agree. `src/install/install.sh` is the script's template: it must run on macOS's bash 3.2, stays inside one function called on its last line, and never uses `sudo` or touches `~/Library`. `scripts/tests/test_install.py` runs it with stand-in commands. CI runs those tests with bash 5 and as root, so also run them on the Mac, where `bash` is 3.2 and the read-only folder case is not skipped, and run `install_check.py` after a change to the script.
- **Every page in every variant.** Each page is tested in both browsers, both widths and both themes, with axe and with JavaScript off. Content and commands must work without JavaScript.

## Architecture rules

- **The core owns the logic.** Git, diffs, storage and file watching live in `backend/core`. The Tauri shell and the dev bridge only forward messages; keep them thin and identical in behaviour.
- **Shell-only calls.** The folder picker (`pick_folder`), folder drops, opening a page of Diffloupe's GitHub repository in the browser (`open_link`, which refuses any other address), installing a downloaded update (`install_update`) and Uninstall (`uninstall_info`, `uninstall`) belong to the shell: Tauri uses its dialog plugin, drag-drop events and the footprint module, and the dev bridge answers with what a test set or records the call (`devbridge_set_pick`, `devbridge_drop`, `devbridge_opened`, `devbridge_update_installed`, `devbridge_uninstalled`), so a test never deletes or replaces real files. Uninstall starts a helper that deletes the footprint again after the app has quit, because macOS and WebKit still write while an app quits. An update works the same way: the core downloads the disk image into `updates/` in the store folder and checks its SHA-256 against the release's `.sha256` file, the shell copies the signed app out of the image next to the installed one, and a helper swaps the two after the app has quit and opens the new one. Debug builds of the Tauri shell also have a smoke hook (`backend/app/src/smoke.rs`) that only `app_smoke.py` and `update_check.py` use; it is not compiled into release builds. While it is active, `DIFFLOUPE_SMOKE_DATA_DIR` moves the store, and Uninstall neither moves the app to the Trash nor deletes its preferences or WebKit's per-user caches, which macOS keeps for the real user whatever `HOME` says.
- **One command contract.** The UI calls the core through one dispatch function: a command name, JSON arguments, a JSON result, and an event stream. Every request, response and event type is a Rust type with `serde` and `ts-rs`. After changing one, run `pnpm types` and commit the generated files. CI fails when they are out of date.
- **Git access.** Read objects in process with `gix`. Run the user's `git` command for status, every write (checkout, merge, commit), network (fetch, push) and `merge-tree`. Never call `git` through a shell; pass arguments as a list. Never force-push and never rewrite history.
- **One diff engine.** All line diffs come from the core (imara-diff, histogram). The UI draws them; it never computes its own line diff. The one exception is the rendered Markdown view in `frontend/src/markdown-diff/`, which matches Markdown blocks and words in the UI with jsdiff (DEC-012). Its raw view still uses the core's diff.
- **The PATH.** Start `git` with the PATH read once from the user's login shell.
- **Private.** The app makes one network connection of its own: the update check in `backend/core/src/update.rs`, which asks GitHub for the latest release at start and once a day while the user's Updates setting is on, through `curl` with no identifier and no usage data. When the user chooses Update, it downloads that release's disk image and checksum from GitHub the same way. Nothing else: no telemetry, no remote fonts, scripts or images. The user's `git` goes online only to their remotes, and only when the user starts such an action. A new network call needs the owner's decision, and the About text and the Updates setting must say it. The site mentions no network calls: it says the app is open source and everything stays on the Mac (DEC-051 in the planning repository's `diffloupe-website/` folder).
- **Footprint.** The app writes outside repositories only to the locations listed in the core's footprint module (the store folder and the `~/Library` folders named by `com.diffloupe.app`). Add any new location there first. Uninstall deletes exactly that list and never touches data of other apps, such as `~/.claude`.
- **Storage.** Preferences go in `settings.json` (atomic write, unknown keys kept, migrations by its `version` key). App state goes in `state.db` (SQLite, WAL, migrations by `PRAGMA user_version`). Only the core opens these files. Every change to them follows [Releases and upgrades](#releases-and-upgrades).
- **No AI.** This version has no AI features. A later version brings them back through a model gateway in the core, with the user's API key or a local model. Until then, add no AI code.

## UI rules

- **Match the frozen design.** Use the design system's classes (`dl-*`) and tokens from `frontend/src/styles/`. Never hard-code a colour, size or font that has a token. Check every screen against the frozen design in light and dark.
- **Icons** are the bundled SVG set in `frontend/src/assets/icons/` (Apache License 2.0, see `NOTICE`), used through `dl-i` classes. Do not add icons from other sets.
- **Text** is short, plain English, sentence case, except git action names, which are in title case ("Commit and Push", "Accept Yours").
- **Unhandled errors** open the error report dialog (`frontend/src/dialogs/ErrorReportDialog.tsx`). Every core and shell call goes through `Backend`, which tells the store each outcome; a `.catch` on a call does not stop the report. An error is handled when its code is in the list in `frontend/src/state/reports.ts`, because the app already explains it or it is an expected race (`notOpen`, `noRepository`). Every other code opens the dialog, and so do UI exceptions: window errors, rejected promises that are not API errors, and crashed views caught by the boundary in `App.tsx`. When a failure is expected, give it its own error code in the core and add that code to the list, rather than silencing it; `gitRefused` and `storeVersion` exist for that reason. A second error joins the open report, a repeated one is counted, and an error the user closed does not reopen the dialog in that session. The report never holds file contents or command arguments, hides the home and every known repository folder when the error is recorded, and the app sends nothing: the user pastes it into the repository's Error report form.
- **Loading** is progressive: show the window at once, show each part as soon as it is ready, and report what is still loading in the status bar's task widget. Never block the window with a loading screen.

## Code rules

- Write code the way the surrounding code is written: same naming, structure and error handling.
- Add no code comments unless a person asks for them.
- Keep functions small and names plain. No abstraction without a present need.
- Rust: `cargo fmt`, `clippy -D warnings`, errors through `thiserror` in the core, no `unwrap()` outside tests.
- TypeScript: strict mode, Biome formatting, no `any`.
- Patched packages: `frontend/patches/` holds pnpm patches, listed in `pnpm-workspace.yaml`. The `@codemirror/legacy-modes` patch lets the Kotlin highlighter load under the frozen prototype. A version bump must carry each patch forward, and the Kotlin test in `frontend/e2e/diff.spec.ts` checks it.

## Tests

Every change ships with tests. All three kinds are required:
- **Unit tests** next to the code: Rust `#[cfg(test)]` modules and Vitest files `*.test.ts(x)` beside the component.
- **Integration tests** for the core's API in `backend/core/tests/`, on real temporary git repositories built by the `testutil` helpers. Every command must have one.
- **UI tests** in `frontend/e2e/` with Playwright through the dev bridge, on a temporary repository, for every user flow. The fixture freezes `Object.prototype` before the page loads, as the Tauri window does (`freezePrototype`), so a library that breaks there fails the tests too. The bridge starts shells as `/bin/sh`, so terminal tests never run the developer's shell profile.

Tests never touch the user's real repositories, real `~/Library` folders or the network. Point the store at a temporary folder. `DIFFLOUPE_UPDATE_URL` replaces GitHub's address for the update check: the Playwright fixture and `app_smoke.py` point it at a closed local port, and update tests point it at a local release server.

## Releases and upgrades

A user upgrades by installing a new `.dmg` over the old app. The new version must start on the old data and keep every setting, recent repository, target branch and stored UI value.

- **Never change the bundle id** `com.diffloupe.app`. macOS keeps the data folder only while it stays the same.
- **Bump the version everywhere at once:** `backend/Cargo.toml`, the top-level `package.json` and `backend/app/tauri.conf.json`, plus a new section in `CHANGELOG.md`. The `release_upgrade` tests fail when they disagree.
- **Changelog sections.** The Changelog page at diffloupe.com shows every section from 0.2.0 on as it is written, so write each one for the person who uses Diffloupe. Put `## <version>` alone on its line, because the release check and the upgrade test match it exactly; the page takes the date and the disk image from the GitHub release. Follow it with one plain sentence that sums up the release, then short `###` groups such as Review, Git, Install and Fixed, each with one-line items in the user's words. List every change to stored data with its migration. Write nothing about AI. `website/tests/changelog.test.ts` fails on a public section without the summary or the groups, and the site build fails on a released one; the Website workflow also runs when only `CHANGELOG.md` changes.
- **Every change to stored data ships with a migration** in `backend/core/src/store.rs`:
  - `state.db`: append a SQL step to `MIGRATIONS`. All pending steps run in one transaction.
  - `settings.json`: append a function to `SETTINGS_MIGRATIONS`. It gets the raw JSON and returns an error when it cannot convert it. The file's `version` key counts the steps that ran.
  - Never edit, reorder or remove a released step. Never rename a stored key, table or column, or reuse it for another meaning, without a migration. Prefer adding new keys that have defaults.
  - Migrations run forward only. An older version refuses data with a higher version and leaves it as it is, so a downgrade never damages data.
- **Backups.** Before migrating, the store copies `state.db` and `settings.json` into `backups/` in the data folder and keeps the last three. A failed migration restores the copy, and the app shows the error instead of starting on half-migrated data.
- **A store fixture per release.** Before releasing, write the fixture of the new version with `DIFFLOUPE_STORE_FIXTURE=tests/fixtures/stores/<version> cargo test -p diffloupe-core --test release_upgrade write_the_store_fixture` from `backend/`, and commit it. Never change a released fixture. `release_upgrade` opens the fixture of every release with the current code and checks that all data survived. When a release stores something new, add it to the fixture writer and check that older fixtures get its default.
- **New files outside the data folder** go into the footprint module first, so Uninstall removes them.
- **Releasing.** Bump the version, write its `CHANGELOG.md` section and its store fixture on a step branch, and merge it into `main` with a green CI run. On that commit of `main`, run `python3 backend/scripts/release_check.py`, then tag the commit with the version and push the tag: `git tag v0.2.0 && git push origin v0.2.0`. The Release workflow (`.github/workflows/release.yml`) runs on version tags and by hand only. It checks the tag, the versions, the notes and the store fixtures on Linux, builds the `.dmg` on macOS, which is the only part that needs a Mac, and creates the GitHub release on Linux with `Diffloupe-<version>.dmg` and `Diffloupe-<version>.dmg.sha256`, the names the site and `install.sh` expect. When it succeeds, the Deploy workflow runs on `main`, so the site shows the new release. If a tag run fails, fix the problem on a step branch, delete the tag (`git push origin :refs/tags/v0.2.0 && git tag -d v0.2.0`) and tag the fixed commit of `main`; a re-run replaces the `.dmg` and its checksum in a release that already exists.
- **Installing a release.** Once diffloupe.com is live, run `curl -fsSL https://diffloupe.com/install.sh | bash`, which installs the latest release with no Gatekeeper dialog. Or download `Diffloupe-<version>.dmg` from the repository's Releases page, open it and drag Diffloupe onto Applications, replacing the old app. The build is not notarised, so macOS blocks the first start of a downloaded copy: allow it once under System Settings → Privacy & Security → Open Anyway.

## Git workflow

- Each plan step is built on its own branch from `main`: `gs/step-<NN>-<slug>`, for example `gs/step-05-changes`.
- Commit messages are one short sentence. No metadata, no co-author lines.
- The repository is open source, so every commit and merge message says what changed in words any reader of the history understands. Never put plan step numbers, decision IDs or other references to the private planning repository in a commit or merge message, for example "Merge the branch log fix for the default branch", not "Merge Step 9.2".
- Merge a finished step into `main` with a merge commit (`git merge --no-ff`), then push `main`. Never force-push. Never rebase or rewrite pushed history.
- **Branches are tested on the Mac, `main` in CI.** GitHub Actions runs on `main` and on releases only, never on a step branch. Before merging, run every local gate on the branch: `pnpm lint`, `pnpm test` and `pnpm e2e`; for a change to the site, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm links` and `pnpm e2e` in `website/`, with the design checkout in place so the design comparison runs; and `app_smoke.py`, `update_check.py` or `release_check.py` when the shell, the updater or the build changed. Merge only a branch whose head already contains the current `main` and whose local gates all pass. CI (`.github/workflows/ci.yml`) then runs on the push to `main`, except a push that changes only `website/`, `.github/workflows/website.yml` or `.github/workflows/website-deploy.yml`. It has two Ubuntu jobs that need no apt packages: `rust` formats, lints and tests `core` and `devbridge` and builds the dev bridge, then `ui` runs Biome, tsc, Vitest, the script tests and Playwright inside Microsoft's Playwright image. It leaves out the Tauri shell crate (`backend/app/`), which needs GTK and WebKit; for a change there, `pnpm lint` and `app_smoke.py` on the Mac are the gate. The Website workflow (`.github/workflows/website.yml`) runs on pushes to `main` that change the site or `CHANGELOG.md`. Runs on `main` never cancel each other, so every commit on `main` gets its own result. The Deploy workflow (`.github/workflows/website-deploy.yml`) runs on pushes to `main` that change the site or `CHANGELOG.md`, by hand, and after each successful Release run, always with the code of `main`. It builds the site from the live releases with `DIFFLOUPE_RELEASE=live`, runs the unit tests and the link check, and deploys to GitHub Pages; it runs only while the repository is public, because GitHub Pages cannot serve it otherwise. If a run on `main` fails, fix it on a new step branch before anything else is merged.
- GitHub Actions minutes are limited, and macOS minutes cost ten times as much. Never start a workflow for a branch. Start the Release workflow by hand (`gh workflow run release.yml --ref main`) only for a change to the macOS build that `release_check.py` cannot check on this Mac.
- The plan for this work lives outside this repository, in the planning repository's `diffloupe/` folder.
