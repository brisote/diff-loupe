#!/bin/bash
set -euo pipefail

install_macos() {
  version="@VERSION@"
  url="@URL@"
  checksum="@SHA256@"
  app="Diffloupe.app"
  target="${DIFFLOUPE_APP_DIR:-}"
  work=""
  mount=""
  staged=""
  old=""
  created=""

  say() { printf '%s\n' "$*"; }
  fail() {
    printf 'Diffloupe was not installed: %s\n' "$*" >&2
    exit 1
  }
  cleanup() {
    local status=$?
    set +e
    if [ -n "$old" ] && [ -d "$old" ]; then
      if [ -e "$target/$app" ]; then rm -rf "$old"; else mv "$old" "$target/$app"; fi
    fi
    if [ -n "$staged" ]; then rm -rf "$staged"; fi
    if [ -n "$mount" ]; then hdiutil detach "$mount" -quiet -force >/dev/null 2>&1; fi
    if [ -n "$work" ]; then rm -rf "$work"; fi
    if [ "$status" -ne 0 ] && [ -n "$created" ]; then rmdir "$target" 2>/dev/null; fi
    return "$status"
  }
  running() { pgrep -f "$target/$app/Contents/MacOS/" >/dev/null 2>&1; }
  trap cleanup EXIT

  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ] || fail "Diffloupe needs a Mac with Apple silicon."
  macos="$(sw_vers -productVersion)"
  [ "${macos%%.*}" -ge 13 ] || fail "Diffloupe needs macOS 13 or later, and this Mac has macOS ${macos}."

  if [ -z "$target" ]; then
    if [ -w /Applications ]; then target="/Applications"; else target="$HOME/Applications"; fi
  fi
  parent="$target"
  [ -d "$parent" ] || parent="$(dirname "$target")"
  [ -d "$parent" ] || fail "the folder $parent does not exist."
  [ -w "$parent" ] || fail "the folder $target is not writable. Set DIFFLOUPE_APP_DIR to a folder you can write to and run the command again."

  work="$(mktemp -d "${TMPDIR:-/tmp}/diffloupe.XXXXXX")"
  say "Downloading Diffloupe ${version}…"
  curl -fsSL --retry 2 -o "$work/Diffloupe.dmg" "$url" || fail "the download stopped. Check the connection and run the command again."
  actual="$(shasum -a 256 "$work/Diffloupe.dmg" | cut -d ' ' -f 1)"
  [ "$actual" = "$checksum" ] || fail "the download does not match its SHA-256 checksum. Nothing was changed. Try again later."

  mkdir "$work/mount"
  hdiutil attach "$work/Diffloupe.dmg" -readonly -nobrowse -noautoopen -mountpoint "$work/mount" -quiet || fail "the disk image cannot be opened."
  mount="$work/mount"
  [ -d "$mount/$app" ] || fail "the disk image holds no $app."
  codesign --verify --deep --strict "$mount/$app" 2>/dev/null || fail "the app's signature does not verify."

  say "Installing into ${target}…"
  if [ ! -d "$target" ]; then
    mkdir "$target" || fail "the folder $target cannot be created."
    created="yes"
  fi
  if [ -d "$target/.$app.old" ]; then
    if [ -e "$target/$app" ]; then rm -rf "$target/.$app.old"; else mv "$target/.$app.old" "$target/$app"; fi
  fi
  staged="$target/.$app.new"
  rm -rf "$staged"
  ditto "$mount/$app" "$staged" || fail "the app cannot be copied into $target."
  xattr -dr com.apple.quarantine "$staged" 2>/dev/null || true

  if running; then
    say "Quitting Diffloupe…"
    pkill -TERM -f "$target/$app/Contents/MacOS/" || true
    tries=0
    while running; do
      [ "$tries" -lt 20 ] || fail "Diffloupe is still running. Quit it and run the command again."
      sleep 0.5
      tries=$((tries + 1))
    done
  fi

  if [ -e "$target/$app" ]; then
    old="$target/.$app.old"
    mv "$target/$app" "$old" || fail "the old app in $target cannot be replaced."
  fi
  mv "$staged" "$target/$app" || fail "the app cannot be moved into $target."
  staged=""
  mdimport "$target/$app" >/dev/null 2>&1 &
  indexing=$!
  tries=0
  while kill -0 "$indexing" 2>/dev/null && [ "$tries" -lt 10 ]; do
    sleep 0.5
    tries=$((tries + 1))
  done

  say "Diffloupe ${version} is installed. Open it with: open \"$target/$app\""
}

install_linux() {
  version="@LINUX_VERSION@"
  deb_url="@DEB_URL@"
  deb_checksum="@DEB_SHA256@"
  rpm_url="@RPM_URL@"
  rpm_checksum="@RPM_SHA256@"
  work=""

  say() { printf '%s\n' "$*"; }
  fail() {
    printf 'Diffloupe was not installed: %s\n' "$*" >&2
    exit 1
  }
  cleanup() {
    local status=$?
    set +e
    if [ -n "$work" ]; then rm -rf "$work"; fi
    return "$status"
  }
  trap cleanup EXIT

  [ -n "$version" ] || fail "no Linux release is available yet."
  arch="$(uname -m)"
  [ "$arch" = "x86_64" ] || fail "Diffloupe for Linux needs a 64-bit x86_64 machine, and this machine is ${arch}."

  if command -v apt-get >/dev/null 2>&1; then
    manager="apt-get"
    url="$deb_url"
    checksum="$deb_checksum"
    package="Diffloupe-${version}-linux-amd64.deb"
  elif command -v dnf >/dev/null 2>&1; then
    manager="dnf"
    url="$rpm_url"
    checksum="$rpm_checksum"
    package="Diffloupe-${version}-linux-x86_64.rpm"
  else
    fail "Diffloupe needs apt-get (Ubuntu or Debian) or dnf (Fedora) to install."
  fi

  work="$(mktemp -d "${TMPDIR:-/tmp}/diffloupe.XXXXXX")"
  chmod 755 "$work"
  say "Downloading Diffloupe ${version}…"
  curl -fsSL --retry 2 -o "$work/$package" "$url" || fail "the download stopped. Check the connection and run the command again."
  chmod 644 "$work/$package"
  actual="$(sha256sum "$work/$package" | cut -d ' ' -f 1)"
  [ "$actual" = "$checksum" ] || fail "the download does not match its SHA-256 checksum. Nothing was changed. Try again later."

  say "Installing ${package}…"
  if [ "$(id -u)" -eq 0 ] && ! command -v sudo >/dev/null 2>&1; then
    "$manager" install -y "$work/$package" || fail "the package could not be installed."
  else
    sudo "$manager" install -y "$work/$package" || fail "the package could not be installed."
  fi

  say "Diffloupe ${version} is installed. Open it with: diffloupe"
}

install_diffloupe() {
  case "$(uname -s)" in
    Darwin) install_macos ;;
    Linux) install_linux ;;
    *)
      printf 'Diffloupe was not installed: %s\n' "Diffloupe runs only on macOS and Linux." >&2
      exit 1
      ;;
  esac
}

install_diffloupe
