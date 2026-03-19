# tests/nixos/nixpi-matrix.nix
# Test that the nixPI Matrix homeserver (Conduwuity) starts and accepts connections

{ pkgs, lib, nixpiModules, nixpiModulesNoShell, piAgent, appPackage, mkNixpiNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "nixpi-matrix";

  nodes.server = { ... }: {
    imports = nixpiModules ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "nixpi-matrix-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs
    systemd.services.localai.wantedBy = lib.mkForce [];
    systemd.services.localai-download.wantedBy = lib.mkForce [];
  };

  testScript = ''
    server = machines[0]

    # Start the server
    server.start()
    
    # Wait for basic system to be up
    server.wait_for_unit("multi-user.target", timeout=300)
    
    # Wait for network to be online
    server.wait_for_unit("network-online.target", timeout=60)
    
    # Test 1: Matrix service starts successfully
    server.wait_for_unit("matrix-synapse.service", timeout=60)
    
    # Test 2: Matrix homeserver responds to client versions endpoint
    server.succeed("curl -sf http://localhost:6167/_matrix/client/versions")
    
    # Test 3: Registration shared secret file was created
    server.succeed("test -f /var/lib/matrix-synapse/registration_shared_secret")
    
    # Test 4: Registration shared secret has correct permissions (readable by service)
    token_perms = server.succeed("stat -c '%a' /var/lib/matrix-synapse/registration_shared_secret").strip()
    assert token_perms in ["640", "644"], f"Unexpected token permissions: {token_perms}"
    
    # Test 5: Can read the shared secret
    token = server.succeed("cat /var/lib/matrix-synapse/registration_shared_secret").strip()
    assert len(token) > 0, "Registration token is empty"
    
    # Test 6: Matrix config file exists and is valid
    server.succeed("test -f /etc/pi/matrix.toml")
    config_content = server.succeed("cat /etc/pi/matrix.toml")
    assert "port = [6167]" in config_content, "Matrix config missing expected port"
    assert "allow_registration = true" in config_content, "Matrix config should allow registration"
    
    # Test 7: Service is running under the Synapse service user
    status = server.succeed("systemctl show matrix-synapse.service -p User --value").strip()
    assert status in ["matrix-synapse", ""] or "dynamic" in status.lower(), f"Unexpected service user: {status}"
    
    # Test 8: State directory exists
    server.succeed("test -d /var/lib/matrix-synapse")
    
    # Test 9: Service restart works
    server.succeed("systemctl restart matrix-synapse.service")
    server.wait_for_unit("matrix-synapse.service", timeout=60)
    server.succeed("curl -sf http://localhost:6167/_matrix/client/versions")
    
    # Test 10: Service is in wantedBy multi-user.target
    server.succeed("systemctl list-dependencies multi-user.target | grep -q matrix-synapse")
    
    print("All nixpi-matrix tests passed!")
  '';
}
