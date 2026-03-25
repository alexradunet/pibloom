import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def load_module():
    module_path = os.environ.get(
        "NIXPI_INSTALLER_HELPER",
        str(Path(__file__).with_name("nixpi_installer.py")),
    )
    spec = importlib.util.spec_from_file_location("nixpi_installer", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NixpiInstallerTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.template_path = Path(
            os.environ.get(
                "NIXPI_INSTALLER_TEMPLATE",
                str(Path(__file__).with_name("nixpi-install-module.nix.in")),
            )
        )
        self.original_template_path = self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = str(self.template_path)

    def tearDown(self):
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = self.original_template_path

    def test_prepare_artifacts_generates_managed_user_install(self):
        cfg = "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n"
        with mock.patch.object(self.module, "hash_password", return_value="$6$fixedhash"):
            artifacts = self.module.prepare_nixpi_install_artifacts(
                "/mnt/target",
                "alex",
                "pi-box",
                "supersecret",
                cfg,
            )

        self.assertEqual(artifacts["nixpi_install_path"], "/mnt/target/etc/nixos/nixpi-install.nix")
        self.assertEqual(artifacts["configuration_path"], "/mnt/target/etc/nixos/configuration.nix")
        self.assertEqual(artifacts["configuration_install_ref"], "/mnt/target/etc/nixos/configuration.nix")
        self.assertIn('nixpi.primaryUser = "alex";', artifacts["nixpi_install_module"])
        self.assertNotIn('nixpi.install.mode = "managed-user";', artifacts["nixpi_install_module"])
        self.assertNotIn('nixpi.createPrimaryUser = true;', artifacts["nixpi_install_module"])
        self.assertIn('users.users."alex".hashedPassword = "$6$fixedhash";', artifacts["nixpi_install_module"])
        self.assertNotIn('users.users."alex".initialPassword', artifacts["nixpi_install_module"])
        self.assertIn('bootstrapPasswordFile = "${config.nixpi.stateDir}/bootstrap/primary-user-password";', artifacts["nixpi_install_module"])
        self.assertIn("@desktopXfceModule@", artifacts["nixpi_install_module"])
        self.assertIn("system.activationScripts.nixpi-bootstrap-primary-password", artifacts["nixpi_install_module"])
        self.assertIn("printf '%s' \"supersecret\" > ${bootstrapPasswordFile}", artifacts["nixpi_install_module"])
        self.assertIn('networking.hostName = "pi-box";', artifacts["configuration_module"])
        self.assertIn("./hardware-configuration.nix", artifacts["configuration_module"])
        self.assertIn("./nixpi-install.nix", artifacts["configuration_module"])

    def test_write_artifacts_writes_minimal_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            nixos_etc = root / "etc/nixos"
            nixos_etc.mkdir(parents=True)
            (nixos_etc / "configuration.nix").write_text(
                "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n",
                encoding="utf-8",
            )

            with mock.patch.object(self.module, "hash_password", return_value="$6$fixedhash"):
                artifacts = self.module.write_nixpi_install_artifacts(
                    root,
                    "alex",
                    "pi-box",
                    "supersecret",
                    self.module.load_base_host_config(nixos_etc),
                )

            for key in ("nixpi_install_path", "configuration_path"):
                self.assertTrue(Path(artifacts[key]).exists())
            self.assertFalse((nixos_etc / "nixpi").exists())
            self.assertFalse((nixos_etc / "nixpkgs").exists())
            self.assertFalse((nixos_etc / "flake.nix").exists())

    def test_prepare_artifacts_updates_single_line_imports_block(self):
        cfg = "{\n  imports = [ ./hardware-configuration.nix ];\n}\n"

        with mock.patch.object(self.module, "hash_password", return_value="$6$fixedhash"):
            artifacts = self.module.prepare_nixpi_install_artifacts(
                "/mnt/target",
                "alex",
                "pi-box",
                "supersecret",
                cfg,
            )

        self.assertEqual(artifacts["configuration_module"].count("imports = ["), 1)
        self.assertIn("  imports = [\n", artifacts["configuration_module"])
        self.assertIn("    ./hardware-configuration.nix", artifacts["configuration_module"])
        self.assertIn("    ./nixpi-install.nix", artifacts["configuration_module"])
        self.assertIn('networking.hostName = "pi-box";', artifacts["configuration_module"])

    def test_prepare_artifacts_restores_hardware_import_when_missing(self):
        cfg = "{\n}\n"

        with mock.patch.object(self.module, "hash_password", return_value="$6$fixedhash"):
            artifacts = self.module.prepare_nixpi_install_artifacts(
                "/mnt/target",
                "alex",
                "pi-box",
                "supersecret",
                cfg,
            )

        self.assertIn("./hardware-configuration.nix", artifacts["configuration_module"])
        self.assertIn("./nixpi-install.nix", artifacts["configuration_module"])
        self.assertIn('networking.hostName = "pi-box";', artifacts["configuration_module"])

    def test_main_prints_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            nixos_etc = root / "etc/nixos"
            nixos_etc.mkdir(parents=True)
            (nixos_etc / "configuration.nix").write_text(
                "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n",
                encoding="utf-8",
            )

            argv = ["nixpi-installer", "--root", tmpdir, "--hostname", "pi-box", "--primary-user", "alex", "--password", "supersecret"]
            with mock.patch("sys.argv", argv):
                with mock.patch.object(self.module, "hash_password", return_value="$6$fixedhash"):
                    with mock.patch("builtins.print") as print_mock:
                        self.module.main()

            payload = json.loads(print_mock.call_args[0][0])
            self.assertEqual(payload["hostname"], "pi-box")


class SetupWizardCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.repo_root = Path(__file__).resolve().parents[4]
        self.setup_wizard_path = self.repo_root / "core/scripts/setup-wizard.sh"

    def _init_git_repo(self, path, *, branch="main", bare=False):
        path.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", f"--initial-branch={branch}", str(path)], check=True)
        if bare:
            return
        subprocess.run(["git", "-C", str(path), "config", "user.name", "Test User"], check=True)
        subprocess.run(["git", "-C", str(path), "config", "user.email", "test@example.com"], check=True)
        (path / "README.md").write_text("test\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(path), "add", "README.md"], check=True)
        subprocess.run(["git", "-C", str(path), "commit", "-m", "init"], check=True)

    def _clone_repo(self, remote, destination, *, branch="main"):
        subprocess.run(
            ["git", "clone", "--branch", branch, str(remote), str(destination)],
            check=True,
            capture_output=True,
            text=True,
        )

    def _run_clone_checkout(self, home_dir, nixpi_dir, remote, branch):
        fake_bin = home_dir / "bin"
        fake_bin.mkdir()
        fake_setup_lib = home_dir / "setup-lib.sh"
        fake_setup_lib.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env bash",
                    "mark_done() { :; }",
                    "mark_done_with() { :; }",
                    "read_checkpoint_data() { :; }",
                    "root_command() {",
                    "  if [[ \"$1\" == \"/run/current-system/sw/bin/nixpi-bootstrap-ensure-repo-target\" ]]; then",
                    "    mkdir -p \"$2\"",
                    "    return 0",
                    "  fi",
                    "  \"$@\"",
                    "}",
                    "write_element_web_runtime_config() { :; }",
                    "write_service_home_runtime() { :; }",
                    "install_home_infrastructure() { return 0; }",
                    "netbird_fqdn() { :; }",
                    "print_service_access_summary() { :; }",
                    "read_bootstrap_primary_password() { :; }",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        fake_setup_lib.chmod(0o755)

        fake_nix = fake_bin / "nix"
        fake_nix.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env bash",
                    "set -euo pipefail",
                    "if [[ \"$1\" == \"--extra-experimental-features\" ]]; then",
                    "  shift 2",
                    "fi",
                    "if [[ \"$1\" != \"run\" || \"$2\" != \"nixpkgs#git\" || \"$3\" != \"--\" ]]; then",
                    "  echo \"unexpected nix invocation: $*\" >&2",
                    "  exit 1",
                    "fi",
                    "shift 3",
                    "exec git \"$@\"",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        fake_nix.chmod(0o755)

        command = f"""
set -euo pipefail
export HOME={home_dir}
export PATH={fake_bin}:$PATH
export SETUP_LIB={fake_setup_lib}
export NIXPI_BOOTSTRAP_REPO={remote}
export NIXPI_BOOTSTRAP_BRANCH={branch}
source <(sed '$d' {self.setup_wizard_path})
export NIXPI_DIR={nixpi_dir}
clone_nixpi_checkout testuser
"""
        return subprocess.run(
            ["bash", "--noprofile", "--norc", "-c", command],
            capture_output=True,
            text=True,
        )

    def test_clone_nixpi_checkout_rejects_existing_non_git_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            home_dir = root / "home"
            nixpi_dir = home_dir / "nixpi"
            nixpi_dir.mkdir(parents=True)
            (nixpi_dir / "not-a-repo.txt").write_text("content\n", encoding="utf-8")

            remote = root / "remote.git"
            self._init_git_repo(remote, bare=True)

            result = self._run_clone_checkout(home_dir, nixpi_dir, remote, "main")
            output = result.stdout + result.stderr

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("canonical repo checkout is missing .git", output)

    def test_clone_nixpi_checkout_accepts_matching_existing_checkout(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            home_dir = root / "home"
            remote_src = root / "remote-src"
            remote = root / "remote.git"
            nixpi_dir = home_dir / "nixpi"

            self._init_git_repo(remote_src, branch="main")
            subprocess.run(["git", "clone", "--bare", str(remote_src), str(remote)], check=True)
            self._clone_repo(remote, nixpi_dir, branch="main")

            result = self._run_clone_checkout(home_dir, nixpi_dir, remote, "main")

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertIn(f"Using existing checkout at {nixpi_dir}.", result.stdout)

    def test_clone_nixpi_checkout_rejects_wrong_remote(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            home_dir = root / "home"
            remote_src = root / "remote-src"
            good_remote = root / "good-remote.git"
            wrong_remote = root / "wrong-remote.git"
            nixpi_dir = home_dir / "nixpi"

            self._init_git_repo(remote_src, branch="main")
            subprocess.run(["git", "clone", "--bare", str(remote_src), str(good_remote)], check=True)
            subprocess.run(["git", "clone", "--bare", str(remote_src), str(wrong_remote)], check=True)
            self._clone_repo(wrong_remote, nixpi_dir, branch="main")

            result = self._run_clone_checkout(home_dir, nixpi_dir, good_remote, "main")
            output = result.stdout + result.stderr

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Existing checkout has unexpected origin URL", output)

    def test_clone_nixpi_checkout_rejects_wrong_branch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            home_dir = root / "home"
            remote_src = root / "remote-src"
            remote = root / "remote.git"
            nixpi_dir = home_dir / "nixpi"

            self._init_git_repo(remote_src, branch="main")
            subprocess.run(["git", "clone", "--bare", str(remote_src), str(remote)], check=True)
            self._clone_repo(remote, nixpi_dir, branch="main")
            subprocess.run(["git", "-C", str(nixpi_dir), "checkout", "-b", "feature"], check=True)

            result = self._run_clone_checkout(home_dir, nixpi_dir, remote, "main")
            output = result.stdout + result.stderr

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Existing checkout is on branch", output)


if __name__ == "__main__":
    unittest.main()
