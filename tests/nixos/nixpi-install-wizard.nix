{ lib, piAgent, appPackage, setupPackage, self, mkTestFilesystems, ... }:

# Boot a system configured exactly as the installer generates it (firstboot +
# network + shell + update + desktop-xfce) and run the full setup wizard.
# This catches regressions where wizard phase scripts are missing from the
# installed package (e.g. wizard-identity.sh not in PATH).

let
  repoSource = lib.cleanSource ../..;
  bootstrapRepoDir = "/var/lib/nixpi-bootstrap";
  bootstrapOriginDir = "${bootstrapRepoDir}/origin.git";
  bootstrapRepoUrl = "file://${bootstrapOriginDir}";
  username = "installer";
  homeDir = "/home/${username}";
  hostName = "nixpi-install-wizard-test";
in
{
  name = "nixpi-install-wizard";

  nodes.nixpi =
    { pkgs, config, ... }:
    {
      # Mirror exactly what the installer-generated module imports.
      imports = [
        ../../core/os/modules/firstboot/default.nix
        ../../core/os/modules/network.nix
        ../../core/os/modules/shell.nix
        ../../core/os/modules/update.nix
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage setupPackage; };

      nixpi.primaryUser = username;
      nixpkgs.config.allowUnfree = true;
      nix.settings.experimental-features = [ "nix-command" "flakes" ];

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;
      virtualisation.graphics = false;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.hostName = hostName;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
        initialPassword = "installerpass123";
      };
      users.groups.${username} = {};

      environment.systemPackages = [ setupPackage pkgs.curl pkgs.jq ];

      # Write the bootstrap password file (mirrors what the installer does).
      system.activationScripts.nixpi-bootstrap-primary-password =
        lib.stringAfter [ "users" ] ''
          install -d -m 0755 -o root -g root "${config.nixpi.stateDir}/bootstrap"
          printf '%s' 'installerpass123' > "${config.nixpi.stateDir}/bootstrap/primary-user-password"
          chmod 0600 "${config.nixpi.stateDir}/bootstrap/primary-user-password"
        '';

      # Write config files mirroring what the installer actually generates:
      # - configuration.nix holds networking.hostName (written by upsert_hostname)
      # - nixpi-install.nix holds nixpi.primaryUser (written from the install template)
      system.activationScripts.nixpi-install-nix =
        lib.stringAfter [ "users" ] ''
          install -d -m 0755 /etc/nixos
          cat > /etc/nixos/configuration.nix <<'EOF'
{ ... }:
{
  imports = [ ./nixpi-install.nix ];
  networking.hostName = "${hostName}";
}
EOF
          cat > /etc/nixos/nixpi-install.nix <<'EOF'
{ ... }:
{
  nixpi.primaryUser = "${username}";
}
EOF
        '';

      # Seed a local git repo so step_appliance / bootstrap upgrade can resolve.
      system.activationScripts.nixpi-prefill =
        lib.stringAfter [ "users" "nixpi-install-nix" ] ''
          mkdir -p ${homeDir}/.nixpi
          rm -rf ${bootstrapRepoDir}
          mkdir -p ${bootstrapRepoDir}/worktree
          cp -R ${repoSource}/. ${bootstrapRepoDir}/worktree/
          chmod -R u+w ${bootstrapRepoDir}/worktree
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree init --initial-branch main
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree config user.name "NixPI Test"
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree config user.email "nixpi-tests@example.invalid"
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree add .
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree commit -m "bootstrap source"
          ${pkgs.git}/bin/git init --bare --initial-branch main ${bootstrapOriginDir}
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree remote add origin ${bootstrapOriginDir}
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree push ${bootstrapOriginDir} main
          cat > ${homeDir}/.nixpi/prefill.env <<'EOF'
PREFILL_USERNAME=testuser
NIXPI_BOOTSTRAP_REPO=${bootstrapRepoUrl}
PREFILL_PASSWORD_DONE=1
EOF
          chown -R ${username}:${username} ${homeDir}/.nixpi
          chmod 755 ${homeDir}/.nixpi
          chmod 644 ${homeDir}/.nixpi/prefill.env
        '';
    };

  testScript = ''
    nixpi = machines[0]
    home = "${homeDir}"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("network-online.target", timeout=60)

    # Verify all wizard scripts are in PATH (regression guard for missing installs).
    nixpi.succeed("command -v setup-wizard.sh")
    nixpi.succeed("command -v wizard-identity.sh")
    nixpi.succeed("command -v wizard-matrix.sh")
    nixpi.succeed("command -v wizard-repo.sh")
    nixpi.succeed("command -v wizard-promote.sh")

    # Run the wizard as the primary user (non-interactive via prefill.env).
    nixpi.succeed("su - ${username} -c 'setup-wizard.sh'")

    # Verify completion marker.
    nixpi.succeed("test -f " + home + "/.nixpi/wizard-state/system-ready")

    # Verify the wizard log contains no shell execution errors.
    log_content = nixpi.succeed("cat " + home + "/.nixpi/wizard.log")
    print("=== Install-wizard log ===")
    print(log_content)
    print("=== End of log ===")
    assert "NixPI Wizard Started" in log_content, "Wizard log missing start marker"
    assert "No such file or directory" not in log_content, (
        "Wizard log contains 'No such file or directory' — a wizard script may be missing"
    )
    assert "command not found" not in log_content, "Wizard log contains shell execution errors"
    assert "setup complete" in log_content.lower(), "Wizard log missing completion marker"

    # Verify the canonical repo was checked out.
    nixpi.succeed("test -d /srv/nixpi/.git")
    nixpi.succeed("test -f /etc/nixpi/canonical-repo.json")

    print("All nixpi-install-wizard tests passed!")
  '';
}
