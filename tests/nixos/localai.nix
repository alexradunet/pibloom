# tests/nixos/localai.nix
# Test that the LocalAI service contract works correctly.
# This test is hermetic: it avoids external model downloads and instead
# verifies the gating and serving contract with a local stub server.

{ pkgs, lib, nixpiModules, nixpiModulesNoShell, piAgent, appPackage, mkNixpiNode, mkTestFilesystems, self ? null, ... }:

let
  testModelName = "test-model.gguf";
in
pkgs.testers.runNixOSTest {
  name = "localai";

  nodes.server = { ... }: {
    imports = nixpiModules ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };
    nixpi.primaryUser = "tester";
    nixpi.install.mode = "managed-user";
    nixpi.createPrimaryUser = true;
    nixpi.llm.enable = true;

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "localai-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs

    # Keep this VM focused on the LocalAI contract only.
    systemd.services.matrix-synapse.wantedBy = lib.mkForce [ ];
    systemd.services.netbird.wantedBy = lib.mkForce [ ];
    systemd.services.nixpi-home.wantedBy = lib.mkForce [ ];
    systemd.services.nixpi-chat.wantedBy = lib.mkForce [ ];
    systemd.services.nixpi-daemon.wantedBy = lib.mkForce [ ];
    systemd.timers.nixpi-update.wantedBy = lib.mkForce [ ];

    # Hermetic model "download": wait briefly so we can assert startup gating,
    # then create a local placeholder model file without network access.
    systemd.services.localai-download = {
      serviceConfig.ExecStart = lib.mkForce (pkgs.writeShellScript "localai-download-test" ''
        dest=/var/lib/localai/models/${testModelName}
        if [ -f "$dest" ]; then
          echo "${testModelName} already present - skipping download"
          exit 0
        fi
        echo "Delaying download briefly so the test can assert startup gating..."
        sleep 15
        echo "Creating test model placeholder..."
        echo "stub model" > "$dest.tmp"
        mv "$dest.tmp" "$dest"
        echo "Download complete: $dest"
      '');
    };

    # Hermetic LocalAI stub. We only need to prove that the service stays down
    # until the model file exists, then serves the expected local API shape.
    systemd.services.localai = {
      unitConfig.ConditionPathExists = lib.mkForce "/var/lib/localai/models/${testModelName}";
      serviceConfig.ExecStart = lib.mkForce (pkgs.writeShellScript "localai-stub-server" ''
        export TEST_MODEL_NAME="${testModelName}"
        exec ${pkgs.python3}/bin/python3 - <<'PY'
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = os.environ["TEST_MODEL_NAME"].replace(".gguf", "")

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"status": "ok"})
        if self.path == "/v1/models":
            return self._send(200, {"object": "list", "data": [{"id": MODEL}]})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            return self._send(404, {"error": "not found"})
        return self._send(200, {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": "test completion"},
                "finish_reason": "stop",
            }],
        })

    def log_message(self, format, *args):
        pass

HTTPServer(("0.0.0.0", 11435), Handler).serve_forever()
PY
      '');
    };
  };

  testScript = ''
    server = machines[0]

    # Start the server
    server.start()
    
    # Wait for network to be online, but do not wait for multi-user.target yet.
    # multi-user.target is only reached after the delayed download finishes, which
    # would make the startup-gating assertions meaningless.
    server.wait_for_unit("network-online.target", timeout=60)

    # Test 1: localai stays down until the model exists, rather than
    # starting early and failing while bootstrap is still in progress.
    server.succeed("test ! -f /var/lib/localai/models/${testModelName}")
    server.succeed("test \"$(systemctl is-active localai.service || true)\" != active")
    server.fail("systemctl --failed --no-legend | grep -q '^localai.service'")

    # Test 2: Model download service completes
    server.wait_until_succeeds("test -f /var/lib/localai/models/${testModelName}", timeout=300)
    server.wait_for_unit("localai-download.service", timeout=300)
    server.wait_for_unit("multi-user.target", timeout=300)

    # Test 3: Model file exists
    server.succeed("test -f /var/lib/localai/models/${testModelName}")

    # Test 4: LocalAI service starts once the model is present
    server.wait_for_unit("localai.service", timeout=60)

    # Test 5: Server responds to health/ready check
    server.wait_until_succeeds("curl -sf http://localhost:11435/health", timeout=60)

    # Test 6: Server responds to completion endpoint
    server.succeed("curl -sf http://localhost:11435/v1/models")

    # Test 7: Can make a simple completion request
    completion_result = server.succeed("""
      curl -sf -X POST http://localhost:11435/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'
    """)
    assert "completion" in completion_result.lower() or "message" in completion_result.lower(), \
        "Unexpected completion response: " + completion_result

    # Test 8: Service is in wantedBy multi-user.target
    server.succeed("systemctl list-dependencies multi-user.target | grep -q localai")

    # Test 9: localai user exists
    server.succeed("id localai")

    # Test 10: Model directory has correct permissions
    server.succeed("test -d /var/lib/localai/models")
    perms = server.succeed("stat -c '%U:%G' /var/lib/localai/models").strip()
    assert "localai" in perms, "Unexpected model directory ownership: " + perms

    # Test 11: Service restart works
    server.succeed("systemctl restart localai.service")
    server.wait_for_unit("localai.service", timeout=60)
    server.wait_until_succeeds("curl -sf http://localhost:11435/health", timeout=30)
    
    print("All localai tests passed!")
  '';
}
