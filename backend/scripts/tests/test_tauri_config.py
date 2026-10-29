from __future__ import annotations

import json
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"
MACOS_ONLY = {"titleBarStyle", "hiddenTitle", "trafficLightPosition"}


def load(name: str) -> dict:
    return json.loads((APP / name).read_text())


class TauriConfigTest(unittest.TestCase):
    def test_the_macos_window_is_the_shared_window_plus_the_overlay_title_bar(self):
        shared = load("tauri.conf.json")["app"]["windows"]
        macos = load("tauri.macos.conf.json")["app"]["windows"]
        self.assertEqual(len(shared), 1)
        self.assertEqual(len(macos), 1)
        self.assertEqual(MACOS_ONLY & set(shared[0]), set())
        self.assertEqual(MACOS_ONLY - set(macos[0]), set())
        self.assertEqual({k: v for k, v in macos[0].items() if k not in MACOS_ONLY}, shared[0])

    def test_each_platform_builds_only_its_own_packages(self):
        self.assertEqual(load("tauri.macos.conf.json")["bundle"]["targets"], ["app", "dmg"])
        self.assertEqual(load("tauri.linux.conf.json")["bundle"]["targets"], ["deb", "rpm"])
        self.assertEqual(load("tauri.windows.conf.json")["bundle"]["targets"], ["nsis"])

    def test_the_windows_bundle_installs_per_user_with_webview_bootstrapper(self):
        windows = load("tauri.windows.conf.json")["bundle"]
        self.assertEqual(windows["publisher"], "Diffloupe")
        self.assertEqual(windows["windows"]["nsis"]["installMode"], "currentUser")
        self.assertEqual(windows["windows"]["webviewInstallMode"], {"type": "downloadBootstrapper", "silent": True})


if __name__ == "__main__":
    unittest.main()
