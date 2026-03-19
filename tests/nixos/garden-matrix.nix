# tests/nixos/garden-matrix.nix
# Test that the Garden Matrix homeserver (Conduwuity) starts and accepts connections

{ pkgs, lib, bloomModules, bloomModulesNoShell, piAgent, appPackage, mkBloomNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "garden-matrix";

  nodes.server = { ... }: {
    imports = bloomModules ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "garden-matrix-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs
  };

  testScript = { nodes, ... }: ''
    import time

    # Start the server
    server.start()
    
    # Wait for basic system to be up
    server.wait_for_unit("multi-user.target", timeout=300)
    
    # Wait for network to be online
    server.wait_for_unit("network-online.target", timeout=60)
    
    # Test 1: Matrix service starts successfully
    server.wait_for_unit("garden-matrix.service", timeout=60)
    
    # Test 2: Matrix homeserver responds to client versions endpoint
    server.succeed("curl -sf http://localhost:6167/_matrix/client/versions")
    
    # Test 3: Registration token file was created
    server.succeed("test -f /var/lib/continuwuity/registration_token")
    
    # Test 4: Registration token has correct permissions (readable by service)
    token_perms = server.succeed("stat -c '%a' /var/lib/continuwuity/registration_token").strip()
    assert token_perms in ["640", "644"], f"Unexpected token permissions: {token_perms}"
    
    # Test 5: Can read the token
    token = server.succeed("cat /var/lib/continuwuity/registration_token").strip()
    assert len(token) > 0, "Registration token is empty"
    
    # Test 6: Matrix config file exists and is valid
    server.succeed("test -f /etc/garden/matrix.toml")
    config_content = server.succeed("cat /etc/garden/matrix.toml")
    assert "port = [6167]" in config_content, "Matrix config missing expected port"
    assert "allow_registration = true" in config_content, "Matrix config should allow registration"
    
    # Test 7: Service is running as dynamic user
    status = server.succeed("systemctl show garden-matrix.service -p User")
    assert "continuwuity" in status or "dynamic" in status.lower(), f"Unexpected service user: {status}"
    
    # Test 8: State directory exists
    server.succeed("test -d /var/lib/continuwuity")
    
    # Test 9: Service restart works
    server.succeed("systemctl restart garden-matrix.service")
    server.wait_for_unit("garden-matrix.service", timeout=60)
    server.succeed("curl -sf http://localhost:6167/_matrix/client/versions")
    
    # Test 10: Service is in wantedBy multi-user.target
    server.succeed("systemctl list-dependencies multi-user.target | grep -q garden-matrix")
    
    print("All garden-matrix tests passed!")
  '';
}
