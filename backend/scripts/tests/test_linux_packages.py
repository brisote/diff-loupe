import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "linux_packages.py"
SPEC = importlib.util.spec_from_file_location("linux_packages", SCRIPT)
assert SPEC and SPEC.loader
linux_packages = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(linux_packages)


class Systems(unittest.TestCase):
    def test_the_packages_are_tried_on_ubuntu_debian_and_fedora(self):
        self.assertEqual(list(linux_packages.SYSTEMS), ["ubuntu:22.04", "debian:12", "fedora:40"])

    def test_debs_use_apt_and_dpkg_and_rpms_use_dnf_and_rpm(self):
        for image, spec in linux_packages.SYSTEMS.items():
            deb = spec["kind"] == "deb"
            self.assertEqual(image.startswith("fedora"), not deb)
            self.assertIn("/pkg/*.deb" if deb else "/pkg/*.rpm", spec["install"])
            self.assertIn("dpkg" if deb else "rpm", spec["installed"])
            self.assertIn("apt-get" if deb else "dnf", spec["remove"])
            self.assertIn("xvfb", spec["prepare"].lower())

    def test_every_system_installs_git_and_sudo_for_the_checks(self):
        for spec in linux_packages.SYSTEMS.values():
            self.assertIn("git", spec["prepare"])
            self.assertIn("sudo", spec["prepare"])


class Updates(unittest.TestCase):
    def test_each_system_names_the_package_a_release_serves_and_how_to_read_its_version(self):
        for spec in linux_packages.SYSTEMS.values():
            deb = spec["kind"] == "deb"
            self.assertEqual(spec["newer"], f"Diffloupe-{linux_packages.NEWER}-linux-{'amd64.deb' if deb else 'x86_64.rpm'}")
            self.assertIn("dpkg-query" if deb else "rpm -q", spec["version"])

    def test_the_release_server_script_exists_and_serves_the_newer_version(self):
        text = linux_packages.SERVER.read_text()
        self.assertTrue(linux_packages.SERVER.is_file())
        self.assertIn(f'VERSION = "{linux_packages.NEWER}"', text)
        self.assertIn("--bad-checksum", text)


class Noise(unittest.TestCase):
    def test_quiet_drops_the_desktop_services_chatter_and_keeps_the_app_output(self):
        text = "\n".join(
            [
                "dbus-daemon[1]: Activating service name='org.freedesktop.portal.Desktop'",
                "",
                "(xdg-desktop-portal-gtk:6): Gtk-WARNING **: cannot open display:",
                "Diffloupe cannot start: broken store",
            ]
        )
        self.assertEqual(linux_packages.quiet(text), "Diffloupe cannot start: broken store")


class Names(unittest.TestCase):
    def test_the_package_is_called_diffloupe(self):
        self.assertEqual(linux_packages.PACKAGE, "diffloupe")


if __name__ == "__main__":
    unittest.main()
