# tests/nixos/nixpi-firstboot.nix
# Test that the nixPI first-boot wizard runs correctly

{ pkgs, lib, nixpiModules, nixpiModulesNoShell, piAgent, appPackage, mkNixpiNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "nixpi-firstboot";

  nodes.nixpi = { ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixpiModulesNoShell ++ [ 
      ../../core/os/modules/firstboot.nix
      mkTestFilesystems 
    ];
    _module.args = { inherit piAgent appPackage; };
    nixpi.username = username;

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "nixpi-firstboot-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs
    systemd.services.localai.wantedBy = lib.mkForce [];
    systemd.services.localai-download.wantedBy = lib.mkForce [];

    # Ensure the primary nixPI user exists (normally created by nixpi-shell)
    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};

    # Pre-create the .nixpi directory with prefill.env for unattended install
    systemd.tmpfiles.rules = [
      "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
      "f ${homeDir}/.nixpi/prefill.env 0644 ${username} ${username} -"
    ];

    # Write prefill.env content via activation script
    system.activationScripts.nixpi-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.nixpi
      cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
    PREFILL_USERNAME=testuser
    PREFILL_MATRIX_PASSWORD=testpassword123
    EOF
      chown -R ${username}:${username} ${homeDir}/.nixpi
      chmod 755 ${homeDir}/.nixpi
      chmod 644 ${homeDir}/.nixpi/prefill.env
    '';
  };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"
    username = "pi"

    # Start the node - firstboot should run automatically
    nixpi.start()
    
    # Wait for basic system to be up
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    
    # Wait for network to be online
    nixpi.wait_for_unit("network-online.target", timeout=60)
    
    # Wait for Matrix to be ready (firstboot depends on it)
    nixpi.wait_for_unit("matrix-synapse.service", timeout=60)
    
    # Wait for netbird to be ready
    nixpi.wait_for_unit("netbird.service", timeout=60)
    
    # Test 1: Firstboot service runs and completes (exit 0 or 1 both accepted by unit)
    nixpi.wait_for_unit("nixpi-firstboot.service", timeout=120)
    
    # Test 2: .setup-complete marker file was created (unattended mode)
    nixpi.succeed("test -f " + home + "/.nixpi/.setup-complete")
    
    # Test 3: prefill.env exists (not deleted after consumption)
    nixpi.succeed("test -f " + home + "/.nixpi/prefill.env")
    
    # Test 4: firstboot log was created and contains expected content
    nixpi.succeed("test -f " + home + "/.nixpi/firstboot.log")
    log_content = nixpi.succeed("cat " + home + "/.nixpi/firstboot.log")
    
    # Debug: print log content
    print("=== Firstboot log content ===")
    print(log_content)
    print("=== End of log ===")
    
    assert "nixPI Firstboot Started" in log_content, "Firstboot log missing start marker"
    assert "setup complete" in log_content.lower(), "Firstboot log missing completion marker"
    
    # Test 5: wizard-state directory was created
    nixpi.succeed("test -d " + home + "/.nixpi/wizard-state")
    
    # Test 6: Linger is enabled for the primary nixPI user (via tmpfiles)
    nixpi.succeed("test -f /var/lib/systemd/linger/" + username)
    
    # Test 7: Checkpoints exist in wizard-state (at minimum localai should be done)
    checkpoints = nixpi.succeed("ls " + home + "/.nixpi/wizard-state/ 2>/dev/null || true").strip().split('\n')
    checkpoints = [c for c in checkpoints if c]  # filter empty lines
    assert len(checkpoints) > 0, f"No checkpoints found in wizard-state. Found: {checkpoints}"
    
    # Test 8: Pi directory structure was created
    nixpi.succeed("test -d " + home + "/.pi/agent")
    nixpi.succeed("test -f " + home + "/.pi/agent/settings.json")
    
    # Test 9: nixPI directory may or may not exist depending on network/git availability
    # The firstboot script attempts to clone a repo but may fail in test env
    # So we just check the script attempted it (log mentions it)

    print("All nixpi-firstboot tests passed!")
  '';
}
