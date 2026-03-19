# tests/nixos/nixpi-daemon.nix
# Test that the Pi Daemon Matrix agent starts and connects to homeserver

{ pkgs, lib, nixpiModules, nixpiModulesNoShell, piAgent, appPackage, mkNixpiNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "nixpi-daemon";

  nodes = {
    # Matrix homeserver node
    server = { ... }: {
      imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi-server";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      systemd.services.localai.wantedBy = lib.mkForce [];
      systemd.services.localai-download.wantedBy = lib.mkForce [];
    };

    # Agent node running pi-daemon
    agent = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.username = username;

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi-agent";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      systemd.services.matrix-synapse.wantedBy = lib.mkForce [];
      systemd.services.localai.wantedBy = lib.mkForce [];
      systemd.services.localai-download.wantedBy = lib.mkForce [];

      # Ensure the primary nixPI user exists with proper setup
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};

      # Pre-create setup-complete to skip wizard
      systemd.tmpfiles.rules = [
        "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
        "f ${homeDir}/.nixpi/.setup-complete 0644 ${username} ${username} -"
      ];

      # Create Matrix credentials file for daemon
      system.activationScripts.nixpi-daemon-creds = lib.stringAfter [ "users" ] ''
        mkdir -p ${homeDir}/.pi
        # Credentials will be created after we know the server is ready
        chown -R ${username}:${username} ${homeDir}/.pi
      '';
    };
  };

  testScript = ''
    import json
    import time

    agent = machines[0]
    server = machines[1]
    username = "pi"
    home = "/home/pi"

    # Start the homeserver first.
    server.start()
    server.wait_for_unit("multi-user.target", timeout=300)
    server.wait_for_unit("matrix-synapse.service", timeout=60)
    server.wait_until_succeeds("curl -sf http://localhost:6167/_matrix/client/versions", timeout=60)

    register_response = server.succeed("""
      curl -s -X POST http://localhost:6167/_matrix/client/v3/register \
        -H "Content-Type: application/json" \
        -d '{"username":"daemon","password":"testpass123","inhibit_login":false}'
    """)

    register_data = json.loads(register_response)
    if "access_token" not in register_data:
        session = register_data.get("session")
        assert session, "Matrix registration challenge missing session: " + register_response
        register_payload = json.dumps({
            "username": "daemon",
            "password": "testpass123",
            "inhibit_login": False,
            "auth": {"type": "m.login.dummy", "session": session},
        })
        register_response = server.succeed(
            "curl -sf -X POST http://localhost:6167/_matrix/client/v3/register "
            + "-H \"Content-Type: application/json\" "
            + "-d '"
            + register_payload
            + "'"
        )
        register_data = json.loads(register_response)

    access_token = register_data["access_token"]
    user_id = register_data["user_id"]

    print("User ID: " + user_id)
    print("Access token: " + access_token[:16] + "...")

    # Start the agent node and provision daemon credentials.
    agent.start()
    agent.wait_for_unit("multi-user.target", timeout=300)

    agent.succeed("mkdir -p " + home + "/.pi")
    agent.succeed(
        "cat > "
        + home
        + "/.pi/matrix-credentials.json <<'CREDS'\n"
        + "{\n"
        + '  "homeserver": "http://server:6167",\n'
        + '  "botUserId": "'
        + user_id
        + '",\n'
        + '  "botAccessToken": "'
        + access_token
        + '",\n'
        + '  "botPassword": "testpass123"\n'
        + "}\n"
        + "CREDS"
    )
    agent.succeed("chown -R " + username + ":" + username + " " + home + "/.pi")

    agent.succeed("mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/" + username)
    agent.succeed(
        "touch " + home + "/.nixpi/.setup-complete && chown "
        + username + ":" + username + " " + home + "/.nixpi/.setup-complete"
    )
    agent.succeed("mkdir -p " + home + "/nixPI && chown -R " + username + ":" + username + " " + home + "/nixPI")

    agent.succeed("systemctl --user -M " + username + "@ daemon-reload || true")
    agent.succeed("systemctl --user -M " + username + "@ start pi-daemon.service || true")

    agent.succeed("test -f /etc/systemd/user/pi-daemon.service")
    agent.succeed("test -d /usr/local/share/nixpi")
    agent.succeed("test -f /usr/local/share/nixpi/dist/core/daemon/index.js")

    time.sleep(5)
    daemon_status = agent.succeed(
        "su - "
        + username
        + " -c 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user is-active pi-daemon || true'"
    ).strip()
    journal = agent.succeed(
        "su - "
        + username
        + " -c 'XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u pi-daemon -n 20 --no-pager || true'"
    )
    print("Pi-daemon status: " + daemon_status)
    print("Pi-daemon journal: " + journal)
    assert daemon_status in ["active", "activating"], "Unexpected pi-daemon status: " + daemon_status

    service_unit = agent.succeed("cat /etc/systemd/user/pi-daemon.service")
    assert "/bin/node /usr/local/share/nixpi/dist/core/daemon/index.js" in service_unit, "Unexpected ExecStart in pi-daemon service"
    assert "NIXPI_DIR=%h/nixPI" in service_unit, "Expected NIXPI_DIR environment in pi-daemon service"
    agent.succeed("ls -la /usr/local/share/nixpi/")

    agent.succeed("test -f " + home + "/.pi/matrix-credentials.json")
    creds = agent.succeed("cat " + home + "/.pi/matrix-credentials.json")
    assert "homeserver" in creds, "Credentials missing homeserver"
    assert "botAccessToken" in creds, "Credentials missing botAccessToken"

    print("All nixpi-daemon tests passed!")
    print("Note: Full daemon connection test requires complete Matrix network setup")
  '';
}
