# NixOS Integration Tests for nixPI

This directory contains NixOS integration tests for the nixPI platform. These tests use the `pkgs.testers.runNixOSTest` framework to spin up QEMU VMs and verify that nixPI services work correctly together.

## Test Suite

| Test | Description | Duration | Nodes |
|------|-------------|----------|-------|
| `config` | Fast build test of the default installed system closure | ~1 min | None |
| `boot` | Basic VM boot and service startup test | ~3 min | 1 |
| `nixpi-matrix` | Matrix homeserver (Synapse) functionality | ~3 min | 1 |
| `nixpi-firstboot` | First-boot preparation and unattended prefill automation | ~5 min | 1 |
| `localai` | LocalAI inference service with test model | ~10 min | 1 |
| `nixpi-network` | Network connectivity and SSH between nodes | ~5 min | 2 |
| `nixpi-daemon` | Pi daemon Matrix agent connection | ~5 min | 2 |
| `nixpi-e2e` | Full end-to-end integration test | ~10 min | 2 |
| `nixpi-home` | nixPI Home plus built-in system web services | ~5 min | 1 |
| `nixpi-modular-services` | Modular-service `configData` and unit wiring for built-ins | ~5 min | 1 |
| `nixpi-matrix-bridge` | Remote Matrix homeserver plus nixPI daemon transport wiring | ~8 min | 3 |

## Running Tests

### Run all tests
```bash
nix flake check
```

### Run a specific test
```bash
nix build .#checks.x86_64-linux.nixpi-matrix --no-link -L
```

### Interactive test driver
```bash
$(nix-build -A checks.x86_64-linux.nixpi-matrix.driverInteractive)/bin/nixos-test-driver
>>> nixpi.start()
>>> nixpi.shell_interact()
```

## Test Structure

```
tests/nixos/
├── lib.nix              # Shared test helpers and module lists
├── default.nix          # Test suite entry point
├── nixpi-matrix.nix     # Matrix homeserver test
├── nixpi-firstboot.nix  # First-boot wizard test
├── localai.nix    # LocalAI inference test
├── nixpi-network.nix    # Network/mesh test
├── nixpi-daemon.nix     # Pi daemon test
├── nixpi-e2e.nix        # End-to-end integration test
├── nixpi-home.nix       # nixPI Home and built-in system services test
├── nixpi-modular-services.nix # system.services/configData regression
├── nixpi-matrix-bridge.nix    # multi-node Matrix daemon transport test
└── README.md            # This file
```

## Writing New Tests

When writing new NixOS tests:

1. **Don't set `nixpkgs.config` in test nodes** - The test framework injects its own `pkgs` and will reject `nixpkgs.config` settings. Use `pkgsUnfree` in `flake.nix` if you need unfree packages.

2. **Escape `''` in test scripts** - The Nix indented string syntax uses `''`. To include literal `''` in Python test scripts (e.g., for empty SSH passphrases), escape it as `''''`.

3. **Escape `${` in test scripts** - Nix interprets `${` as antiquotation. Escape it as `''${` inside indented strings.

4. **Use `nixpiModulesNoShell` when defining your own user** - The shell module defines the primary nixPI operator user from `nixpi.primaryUser`, so tests that define their own should use `nixpiModulesNoShell` instead of `nixpiModules`.

Example:
```nix
{ pkgs, lib, nixpiModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "my-test";
  
  nodes.server = { ... }: {
    imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };
    
    nixpi.primaryUser = "pi";
    users.users.pi = { ... };
  };
  
  testScript = ''
    server.start()
    server.wait_for_unit("multi-user.target")
    
    # Escape '' in shell commands
    server.succeed("ssh-keygen -N '''' -f /root/.ssh/id_rsa")
    
    # Use string concatenation instead of f-strings with ${}
    msg = "Hello " + name
  '';
}
```

## CI Integration

The NixOS tests run in CI via `.github/workflows/nixos-tests.yml`:

- **Fast checks** (`config`) run on every PR
- **VM tests** require KVM and run on self-hosted runners or can be triggered manually
- Tests are skipped if KVM is not available

To enable full VM tests in CI:
1. Set up a self-hosted runner with KVM support
2. Set the `NIXOS_TEST_RUNNER` repository variable to the runner label
3. Optionally configure Cachix for faster builds

## Debugging Failed Tests

When a test fails, you can:

1. **Check the test log**: The `-L` flag shows full test output
   ```bash
   nix build .#checks.x86_64-linux.nixpi-matrix -L
   ```

2. **Run interactively**: Use the interactive driver to debug
   ```bash
   $(nix-build -A checks.x86_64-linux.nixpi-matrix.driverInteractive)/bin/nixos-test-driver
   >>> server.start()
   >>> server.execute("systemctl status nixpi-matrix")
   >>> server.shell_interact()  # Get a shell
   ```

3. **Check VM logs**: Tests capture systemd journal output which is printed on failure

## References

- [NixOS Test Driver Documentation](https://nixos.org/manual/nixos/stable/#sec-nixos-tests)
- [NixOS Testing Infrastructure](https://nixos.wiki/wiki/NixOS_Testing_infrastructure)
- [Integration testing with NixOS virtual machines](https://nix.dev/tutorials/integration-testing-using-virtual-machines.html)
