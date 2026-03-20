# tests/nixos/nixpi-daemon.nix
# Test that the Pi Daemon Matrix agent starts and connects to homeserver

{ pkgs, lib, nixpiModules, nixpiModulesNoShell, piAgent, appPackage, mkNixpiNode, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-daemon";

  nodes = {
    # Matrix homeserver node
    server = { ... }: let
      username = "server";
      homeDir = "/home/${username}";
    in {
      imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.primaryUser = username;

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

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" "agent" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};
    };

    # Agent node running nixpi-daemon
    agent = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.primaryUser = username;

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
      # Ensure the primary nixPI user exists with proper setup
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" "agent" ];
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
        mkdir -p /var/lib/nixpi/agent
        chown -R agent:agent /var/lib/nixpi/agent
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

    agent.succeed("mkdir -p /var/lib/nixpi/agent")
    agent.succeed(
        "cat > "
        + "/var/lib/nixpi/agent/matrix-credentials.json <<'CREDS'\n"
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
    agent.succeed("chown -R agent:agent /var/lib/nixpi/agent")

    agent.succeed(
        "touch " + home + "/.nixpi/.setup-complete && chown "
        + username + ":" + username + " " + home + "/.nixpi/.setup-complete"
    )
    agent.succeed("mkdir -p " + home + "/nixPI && chown -R " + username + ":" + username + " " + home + "/nixPI")

    agent.succeed("systemctl start nixpi-daemon.service || true")

    agent.succeed("test -f /etc/systemd/system/nixpi-daemon.service")
    agent.succeed("test -d /usr/local/share/nixpi")
    agent.succeed("test -f /usr/local/share/nixpi/dist/core/daemon/index.js")

    time.sleep(5)
    daemon_status = agent.succeed("systemctl is-active nixpi-daemon.service || true").strip()
    journal = agent.succeed("journalctl -u nixpi-daemon.service -n 20 --no-pager || true")
    print("nixpi-daemon status: " + daemon_status)
    print("nixpi-daemon journal: " + journal)
    assert daemon_status in ["active", "activating"], "Unexpected nixpi-daemon status: " + daemon_status

    service_unit = agent.succeed("systemctl cat nixpi-daemon.service")
    exec_start = agent.succeed("systemctl show -p ExecStart --value nixpi-daemon.service")
    environment = agent.succeed("systemctl show -p Environment --value nixpi-daemon.service")
    working_directory = agent.succeed("systemctl show -p WorkingDirectory --value nixpi-daemon.service").strip()
    assert "node" in exec_start and "/usr/local/share/nixpi/dist/core/daemon/index.js" in exec_start, \
        "Unexpected ExecStart in nixpi-daemon service: " + exec_start
    assert "NIXPI_DIR=/home/pi/nixPI" in environment, "Expected NIXPI_DIR environment in nixpi-daemon service"
    assert working_directory == "/home/pi/nixPI", "Unexpected WorkingDirectory: " + working_directory
    agent.succeed("ls -la /usr/local/share/nixpi/")

    agent.succeed("test -f /var/lib/nixpi/agent/matrix-credentials.json")
    creds = agent.succeed("cat /var/lib/nixpi/agent/matrix-credentials.json")
    assert "homeserver" in creds, "Credentials missing homeserver"
    assert "botAccessToken" in creds, "Credentials missing botAccessToken"

    print("All nixpi-daemon tests passed!")
    print("Note: Full daemon connection test requires complete Matrix network setup")
  '';
}
