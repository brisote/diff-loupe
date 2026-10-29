import importlib.util
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "platform_check.py"
SPEC = importlib.util.spec_from_file_location("platform_check", SCRIPT)
assert SPEC and SPEC.loader
platform_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(platform_check)


class ImageTag(unittest.TestCase):
    def test_the_tag_follows_the_dockerfile_and_the_playwright_version(self):
        first = platform_check.image_tag("FROM a\n", "1.64.1")
        self.assertTrue(first.startswith("diffloupe-linux-gates:"))
        self.assertEqual(first, platform_check.image_tag("FROM a\n", "1.64.1"))
        self.assertNotEqual(first, platform_check.image_tag("FROM b\n", "1.64.1"))
        self.assertNotEqual(first, platform_check.image_tag("FROM a\n", "1.65.0"))

    def test_the_playwright_version_comes_from_the_ui_package(self):
        package = '{"devDependencies": {"@playwright/test": "1.64.1"}}'
        self.assertEqual(platform_check.playwright_version(package), "1.64.1")


class DockerRun(unittest.TestCase):
    def test_the_checkout_is_mounted_and_build_output_stays_in_volumes(self):
        args = platform_check.docker_run("img:1", Path("/repo"), "cargo test")
        self.assertEqual(args[:3], ["docker", "run", "--rm"])
        self.assertIn("/repo:/work", args)
        for name, path in platform_check.LINUX_VOLUMES.items():
            self.assertIn(f"{name}:{path}", args)
        self.assertIn("diffloupe-linux-target:/work/backend/target", args)
        self.assertIn("diffloupe-linux-frontend-node:/work/frontend/node_modules", args)
        self.assertEqual(args[-4:-1], ["img:1", "bash", "-c"])
        self.assertIn("setpriv --reuid=pwuser --regid=pwuser", args[-1])
        self.assertIn("rustup toolchain install stable", args[-1])
        self.assertTrue(args[-1].endswith("&& cargo test'"))
        self.assertIn("diffloupe-linux-frontend-dist:/work/frontend/dist", args)

    def test_volumes_owned_by_root_are_handed_to_the_user_first(self):
        command = platform_check.as_user("pnpm e2e")
        self.assertIn("chown -R pwuser:pwuser", command)
        self.assertIn("/work/backend/target", command)
        self.assertLess(command.index("chown"), command.index("setpriv"))

    def test_the_rust_toolchain_lives_in_a_volume(self):
        self.assertIn("diffloupe-linux-rustup", platform_check.LINUX_VOLUMES)

    def test_the_container_reaps_orphans_and_runs_as_on_ci(self):
        args = platform_check.docker_run("i", Path("/repo"), "x")
        self.assertIn("--init", args)
        self.assertEqual(args[args.index("-e") + 1], "CI=true")


class Gates(unittest.TestCase):
    def test_the_linux_gates_include_the_shell_crate(self):
        self.assertIn("--workspace", platform_check.LINUX_GATES["clippy"])
        self.assertNotIn("--exclude", platform_check.LINUX_GATES["clippy"])
        self.assertNotIn("--exclude", platform_check.LINUX_GATES["test"])
        self.assertIn("pnpm e2e --workers=2", platform_check.LINUX_GATES["ui"])
        self.assertIn("playwright install webkit", platform_check.WINDOWS_REMOTE_GATES["ui"])
        self.assertIn("--store-dir /home/pwuser/.local/share/pnpm/store", platform_check.LINUX_GATES["ui"])

    def test_the_linux_smoke_gate_runs_the_app_under_a_virtual_display_and_a_session_bus(self):
        smoke = platform_check.LINUX_GATES["smoke"]
        self.assertIn("dbus-run-session", smoke)
        self.assertIn("xvfb-run", smoke)
        self.assertIn("backend/scripts/app_smoke.py", smoke)

    def test_the_windows_smoke_gate_runs_app_smoke_for_windows(self):
        smoke = platform_check.WINDOWS_REMOTE_GATES["smoke"]
        self.assertIn("app_smoke.py", smoke)
        self.assertIn("--platform windows", smoke)

    def test_only_picks_the_named_gates_in_order(self):
        picked = platform_check.chosen(platform_check.LINUX_GATES, ["test", "fmt"])
        self.assertEqual(list(picked), ["test", "fmt"])
        self.assertEqual(platform_check.chosen(platform_check.LINUX_GATES, None), platform_check.LINUX_GATES)

    def test_an_unknown_gate_stops_the_run(self):
        with self.assertRaises(SystemExit):
            platform_check.chosen(platform_check.LINUX_GATES, ["lint"])


class Windows(unittest.TestCase):
    def test_clippy_checks_the_windows_target_in_its_own_folder(self):
        args = platform_check.xwin_clippy()
        self.assertEqual(args[:3], ["cargo", "xwin", "clippy"])
        self.assertIn("x86_64-pc-windows-msvc", args)
        self.assertIn("backend/target/windows", args)
        self.assertEqual(args[-3:], ["--", "-D", "warnings"])

    def test_remote_commands_run_in_the_checkout_under_the_user_folder(self):
        command = platform_check.remote_command("pnpm e2e")
        self.assertTrue(command.startswith("cmd /d /c "))
        self.assertIn("%USERPROFILE%\\diffloupe-check", command)
        self.assertIn("pnpm e2e", command)
        self.assertIn("set CI=1&& pnpm e2e", command)

    def test_sync_checks_out_the_sent_commit_without_line_ending_conversion(self):
        command = platform_check.remote_sync("abc123")
        self.assertIn("git init -q diffloupe-check", command)
        self.assertIn("git fetch -q ..\\diffloupe.bundle HEAD", command)
        self.assertIn("git -c core.autocrlf=false checkout -q -f abc123", command)
        self.assertTrue(command.endswith("git clean -q -fd\""))

    def test_without_a_host_only_clippy_runs(self):
        with mock.patch.object(platform_check, "step", return_value=True) as step:
            results = platform_check.windows(None, None)
        self.assertEqual(results, [("clippy", True)])
        self.assertEqual(step.call_count, 1)

    def test_with_a_host_the_commit_is_sent_and_every_remote_gate_runs(self):
        with (
            mock.patch.object(platform_check, "step", return_value=True) as step,
            mock.patch.object(platform_check.subprocess, "run") as run,
            mock.patch.object(Path, "mkdir"),
        ):
            run.return_value.stdout = "abc123\n"
            results = platform_check.windows(["test", "ui"], "ada@win")
        names = [call.args[0] for call in step.call_args_list]
        self.assertEqual(names, ["bundle", "send", "checkout", "test", "ui"])
        self.assertEqual(results, [("test", True), ("ui", True)])
        self.assertEqual(step.call_args_list[1].args[1][-1], "ada@win:diffloupe.bundle")

    def test_a_failed_sync_runs_no_remote_gate(self):
        with (
            mock.patch.object(platform_check, "step", side_effect=[True, False]),
            mock.patch.object(platform_check.subprocess, "run") as run,
            mock.patch.object(Path, "mkdir"),
        ):
            run.return_value.stdout = "abc123\n"
            results = platform_check.windows(["test"], "ada@win")
        self.assertEqual(results, [("sync", False)])


if __name__ == "__main__":
    unittest.main()
