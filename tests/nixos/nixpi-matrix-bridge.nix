{ pkgs, lib, nixpiModulesNoShell, piAgent, appPackage, mkTestFilesystems, matrixTestClient, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-matrix-bridge";

  nodes = {
    homeserver = { ... }: {
      imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };

      networking.hostName = "nixpi";

      systemd.services.localai.wantedBy = lib.mkForce [ ];
      systemd.services.localai-download.wantedBy = lib.mkForce [ ];
      systemd.services.netbird.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-home.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-chat.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-files.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-code.wantedBy = lib.mkForce [ ];
      systemd.timers.nixpi-update.wantedBy = lib.mkForce [ ];
    };

    nixpi = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.primaryUser = username;

      networking.hostName = "nixpi-agent";

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" "agent" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};

      systemd.services.matrix-synapse.wantedBy = lib.mkForce [ ];
      systemd.services.localai.wantedBy = lib.mkForce [ ];
      systemd.services.localai-download.wantedBy = lib.mkForce [ ];
      systemd.services.netbird.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-home.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-chat.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-files.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-code.wantedBy = lib.mkForce [ ];
      systemd.timers.nixpi-update.wantedBy = lib.mkForce [ ];

      system.activationScripts.nixpi-bridge-fixtures = lib.stringAfter [ "users" ] ''
        install -d -m 0755 -o ${username} -g ${username} ${homeDir}/.nixpi
        install -d -m 0775 -o ${username} -g agent ${homeDir}/nixPI
        install -d -m 0775 -o ${username} -g agent ${homeDir}/nixPI/Agents
        install -d -m 0775 -o ${username} -g agent ${homeDir}/nixPI/Agents/host
        cat > ${homeDir}/nixPI/Agents/host/AGENTS.md <<'EOF'
---
id: host
name: Pi
matrix:
  username: host
  autojoin: true
respond:
  mode: silent
---
You are Pi.
EOF
        chown -R ${username}:agent ${homeDir}/nixPI
        touch ${homeDir}/.nixpi/.setup-complete
        chown ${username}:${username} ${homeDir}/.nixpi/.setup-complete
        install -d -m 0700 -o agent -g agent /var/lib/nixpi/agent/matrix-agents
      '';

      environment.systemPackages = [ pkgs.curl pkgs.jq ];
    };

    client = {
      imports = [ mkTestFilesystems ];
      networking.hostName = "client";
      environment.systemPackages = [ matrixTestClient pkgs.curl pkgs.jq ];
      virtualisation.diskSize = 5120;
      virtualisation.memorySize = 1024;
      virtualisation.graphics = false;
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.networkmanager.enable = true;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      system.stateVersion = "25.05";
    };
  };

  testScript = ''
    import json
    import urllib.parse

    client = machines[0]
    homeserver = machines[1]
    nixpi = machines[2]

    start_all()

    homeserver.wait_for_unit("matrix-synapse.service", timeout=120)
    homeserver.wait_until_succeeds("curl -sf http://127.0.0.1:6167/_matrix/client/versions", timeout=60)

    def register(username, password):
        response = homeserver.succeed(
            "curl -s -X POST http://127.0.0.1:6167/_matrix/client/v3/register "
            + "-H 'Content-Type: application/json' "
            + "-d '{\"username\":\"" + username + "\",\"password\":\"" + password + "\",\"inhibit_login\":false}'"
        )
        data = json.loads(response)
        if "access_token" in data:
            return data
        session = data.get("session")
        assert session, response
        payload = json.dumps({
            "username": username,
            "password": password,
            "inhibit_login": False,
            "auth": {"type": "m.login.dummy", "session": session},
        })
        return json.loads(
            homeserver.succeed(
                "curl -sf -X POST http://127.0.0.1:6167/_matrix/client/v3/register "
                + "-H 'Content-Type: application/json' "
                + "-d '" + payload + "'"
            )
        )

    host_creds = register("host", "hostpass123")
    admin_creds = register("operator", "operatorpass123")

    room = json.loads(homeserver.succeed(
        "curl -sf -X POST http://127.0.0.1:6167/_matrix/client/v3/createRoom "
        + "-H 'Authorization: Bearer " + admin_creds["access_token"] + "' "
        + "-H 'Content-Type: application/json' "
        + "-d '{"
        + "\"preset\":\"private_chat\","
        + "\"room_alias_name\":\"general\","
        + "\"invite\":[\"@host:nixpi\"]"
        + "}'"
    ))
    room_id = room["room_id"]
    room_id_enc = urllib.parse.quote(room_id, safe="")

    nixpi.succeed(
        "cat > /var/lib/nixpi/agent/matrix-agents/host.json <<'EOF'\n"
        + json.dumps({
            "homeserver": "http://homeserver:6167",
            "userId": host_creds["user_id"],
            "accessToken": host_creds["access_token"],
            "password": "hostpass123",
            "username": "host",
        }, indent=2)
        + "\nEOF"
    )
    nixpi.succeed("chown agent:agent /var/lib/nixpi/agent/matrix-agents/host.json")
    nixpi.succeed("chmod 600 /var/lib/nixpi/agent/matrix-agents/host.json")

    nixpi.wait_for_unit("pi-daemon.service", timeout=120)

    homeserver.wait_until_succeeds(
        "curl -sf http://127.0.0.1:6167/_matrix/client/v3/rooms/"
        + room_id_enc
        + "/members -H 'Authorization: Bearer "
        + admin_creds["access_token"]
        + "' | grep -q '\"membership\":\"join\"' && "
        + "curl -sf http://127.0.0.1:6167/_matrix/client/v3/rooms/"
        + room_id_enc
        + "/members -H 'Authorization: Bearer "
        + admin_creds["access_token"]
        + "' | grep -q '@host:nixpi'",
        timeout=60,
    )

    client.succeed(
        "nixpi-matrix-client http://homeserver:6167 clientuser clientpass123 '#general:nixpi' "
        + "'hello from integration test' -"
    )

    nixpi.succeed("journalctl -u pi-daemon.service --no-pager | grep -q 'pi-daemon running'")
    homeserver.succeed(
        "curl -sf http://127.0.0.1:6167/_matrix/client/v3/rooms/"
        + room_id_enc
        + "/messages?dir=b&limit=10 -H 'Authorization: Bearer "
        + admin_creds["access_token"]
        + "' | grep -q 'hello from integration test'"
    )

    print("nixPI matrix bridge transport test passed!")
  '';
}
