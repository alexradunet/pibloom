# tests/nixos/lib.nix
# Shared helpers for nixPI NixOS integration tests

{ pkgs, lib }:

{
  mkBaseNode = extraConfig: {
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    virtualisation.graphics = false;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = lib.mkDefault "nixos";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
  } // extraConfig;

  # Common test configuration for nixPI nodes
  mkNixpiNode = { nixpiModules, piAgent, appPackage, extraConfig ? {} }: {
    imports = nixpiModules ++ [ extraConfig ];
    _module.args = { inherit piAgent appPackage; };

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    virtualisation.graphics = false;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = lib.mkDefault "nixos";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
  };

  # Minimal filesystem configuration for test VMs
  mkTestFilesystems = {
    fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
    fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
  };

  # Standard nixPI modules list
  nixpiModules = [
    ../../core/os/modules/app.nix
    ../../core/os/modules/llm.nix
    ../../core/os/modules/matrix.nix
    ../../core/os/modules/network.nix
    ../../core/os/modules/shell.nix
    ../../core/os/modules/update.nix
  ];

  # nixPI modules without nixpi-shell (for tests that define their own operator user)
  nixpiModulesNoShell = [
    ../../core/os/modules/options.nix
    ../../core/os/modules/app.nix
    ../../core/os/modules/llm.nix
    ../../core/os/modules/matrix.nix
    ../../core/os/modules/network.nix
    ../../core/os/modules/update.nix
  ];

  matrixTestClient = pkgs.writers.writePython3Bin "nixpi-matrix-client" {
    libraries = with pkgs.python3Packages; [ matrix-nio ];
    flakeIgnore = [ "E501" ];
  } ''
    import asyncio
    import json
    import sys

    from nio import AsyncClient, JoinResponse, RoomMessageText


    async def ensure_registered(client, username, password):
        response = await client.register(username, password)
        if hasattr(response, "access_token"):
            return response
        session = getattr(response, "session", None)
        if not session:
            raise RuntimeError(f"register failed: {response}")
        response = await client.register(
            username,
            password,
            auth={"type": "m.login.dummy", "session": session},
        )
        if not hasattr(response, "access_token"):
            raise RuntimeError(f"dummy auth register failed: {response}")
        return response


    async def main():
        homeserver, username, password, room_alias, outbound, expected = sys.argv[1:7]
        client = AsyncClient(homeserver)
        response = await ensure_registered(client, username, password)
        client.access_token = response.access_token
        client.user_id = response.user_id

        join = await client.join(room_alias)
        if not isinstance(join, JoinResponse):
            raise RuntimeError(f"join failed: {join}")
        room_id = join.room_id

        got_expected = False

        async def on_message(_room, event):
            nonlocal got_expected
            if isinstance(event, RoomMessageText) and expected in event.body:
                got_expected = True
                await client.close()

        client.add_event_callback(on_message, RoomMessageText)
        await client.room_send(
            room_id=room_id,
            message_type="m.room.message",
            content={"msgtype": "m.text", "body": outbound},
        )

        if expected == "-":
            print(json.dumps({"room_id": room_id, "user_id": client.user_id}))
            await client.close()
            return

        for _ in range(30):
            await client.sync(timeout=1000)
            if got_expected:
                print(json.dumps({"room_id": room_id, "user_id": client.user_id}))
                return

        raise RuntimeError("timed out waiting for expected reply")

    asyncio.run(main())
  '';

  # Test utilities package
  testUtils = pkgs.writeShellScriptBin "nixpi-test-utils" ''
    # Wait for a systemd unit to be active on the system bus
    wait_for_unit_active() {
      local unit="$1"
      local timeout="''${2:-30}"
      local elapsed=0
      
      while ! systemctl is-active "$unit" 2>/dev/null | grep -q active; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ "$elapsed" -ge "$timeout" ]; then
          echo "Timeout waiting for unit $unit"
          return 1
        fi
      done
    }
    
    # Register a Matrix user on the local Synapse instance
    register_matrix_user() {
      local username="$1"
      local password="$2"
      local homeserver="''${3:-http://localhost:6167}"

      local step1
      step1=$(curl -s -X POST "''${homeserver}/_matrix/client/v3/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\",\"inhibit_login\":false}")

      if echo "$step1" | grep -q '"access_token"'; then
        echo "$step1"
        return 0
      fi

      local session
      session=$(printf '%s' "$step1" | sed -n 's/.*"session"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
      if [ -n "$session" ]; then
        curl -sf -X POST "''${homeserver}/_matrix/client/v3/register" \
          -H "Content-Type: application/json" \
          -d "{\"username\":\"$username\",\"password\":\"$password\",\"inhibit_login\":false,\"auth\":{\"type\":\"m.login.dummy\",\"session\":\"$session\"}}"
        return 0
      fi

      printf '%s\n' "$step1" >&2
      return 1
    }
    
    # Get Matrix registration token from file
    get_matrix_token() {
      local token_file="/var/lib/matrix-synapse/registration_shared_secret"
      if [ -f "$token_file" ]; then
        cat "$token_file"
      else
        echo ""
      fi
    }
    
    # Check if Matrix homeserver is ready
    matrix_ready() {
      local homeserver="''${1:-http://localhost:6167}"
      curl -sf "''${homeserver}/_matrix/client/versions" >/dev/null 2>&1
    }
    
    # Wait for Matrix homeserver to be ready
    wait_for_matrix() {
      local homeserver="''${1:-http://localhost:6167}"
      local timeout="''${2:-60}"
      local elapsed=0
      
      while ! matrix_ready "$homeserver"; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ "$elapsed" -ge "$timeout" ]; then
          echo "Timeout waiting for Matrix homeserver"
          return 1
        fi
      done
    }
  '';
}
