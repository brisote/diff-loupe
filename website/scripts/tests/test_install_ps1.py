import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parents[2] / "src/install/install.ps1"
PAYLOAD = b"Diffloupe 0.4.0 setup exe\n"


class InstallPs1TemplateTest(unittest.TestCase):
    def test_template_exists_and_contains_placeholders(self):
        text = TEMPLATE.read_text()
        self.assertIn("@WINDOWS_VERSION@", text)
        self.assertIn("@SETUP_URL@", text)
        self.assertIn("@SETUP_SHA256@", text)
        self.assertIn("Diffloupe was not installed", text)
        self.assertIn("Start-Process", text)
        self.assertIn("Get-FileHash", text)
        self.assertIn("Unblock-File", text)

    def test_template_braces_and_parentheses_are_balanced(self):
        text = TEMPLATE.read_text()
        self.assertEqual(text.count("{"), text.count("}"))
        self.assertEqual(text.count("("), text.count(")"))


@unittest.skipUnless(shutil.which("pwsh"), "pwsh is not installed on this system")
class InstallPs1ExecutionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="dl-install-ps1-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.setup_file = self.tmp / "setup.exe"
        self.setup_file.write_bytes(PAYLOAD)
        self.checksum = hashlib.sha256(PAYLOAD).hexdigest()

    def filled_script(self, version="0.4.0", url=None, checksum=None):
        text = TEMPLATE.read_text()
        setup_url = url or self.setup_file.as_uri()
        return (
            text.replace("@WINDOWS_VERSION@", version)
            .replace("@SETUP_URL@", setup_url)
            .replace("@SETUP_SHA256@", checksum or self.checksum)
        )

    def run_ps1(self, script_text, env=None):
        script_path = self.tmp / "install.ps1"
        script_path.write_text(script_text)
        run_env = {**os.environ, **(env or {})}
        return subprocess.run(
            ["pwsh", "-NoProfile", "-NonInteractive", "-File", str(script_path)],
            capture_output=True,
            text=True,
            env=run_env,
        )

    def test_missing_version_or_url_fails(self):
        script = self.filled_script(version="", url="")
        res = self.run_ps1(script)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("no Windows release is available yet", res.stderr)

    def test_wrong_checksum_fails(self):
        script = self.filled_script(checksum="0" * 64)
        res = self.run_ps1(script)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("does not match its SHA-256 checksum", res.stderr)


if __name__ == "__main__":
    unittest.main()
