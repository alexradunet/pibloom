# tests/nixos/nixpi-netbird-provisioner.nix
{ lib, nixPiModulesNoShell, mkTestFilesystems, ... }:

{
  name = "nixpi-netbird-provisioner";

  nodes.nixpi = { pkgs, ... }: {
    imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];

    nixpi.primaryUser = "pi";
    networking.hostName = "pi";
    system.stateVersion = "25.05";
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    virtualisation.diskSize = 4096;
    virtualisation.memorySize = 1024;

    users.users.pi = {
      isNormalUser = true;
      group = "pi";
      extraGroups = [ "wheel" ];
    };
    users.groups.pi = {};

    # Write a fake API token so the provisioner can start
    system.activationScripts.netbird-test-token = ''
      install -d -m 0700 /var/lib/nixpi/secrets
      echo -n "test-token-abc123" > /var/lib/nixpi/secrets/netbird-api-token
      chown -R nixpi:nixpi /var/lib/nixpi/secrets || true
    '';

    # Override endpoint to point at mock server
    nixpi.netbird.apiTokenFile = "/var/lib/nixpi/secrets/netbird-api-token";
    nixpi.netbird.apiEndpoint = "http://127.0.0.1:19999";

    # Mock NetBird API server (returns empty lists for all GETs, 200 for POSTs)
    systemd.services.mock-netbird-api = {
      description = "Mock NetBird API";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "simple";
        ExecStart = pkgs.writeShellScript "mock-api" ''
          ${pkgs.python3}/bin/python3 -c "
import http.server, json

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps([]).encode())
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        self.rfile.read(length)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'id': 'test-id'}).encode())
    def do_PUT(self):
        self.do_POST()

http.server.HTTPServer(('127.0.0.1', 19999), H).serve_forever()
"
        '';
      };
    };
  };

  testScript = ''
    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=120)
    nixpi.wait_for_unit("mock-netbird-api.service", timeout=30)

    # Provisioner should reach active (exited)
    nixpi.wait_for_unit("nixpi-netbird-provisioner.service", timeout=60)
    nixpi.succeed("systemctl is-active nixpi-netbird-provisioner.service || systemctl show -p SubState --value nixpi-netbird-provisioner.service | grep -q exited")

    # Idempotency: running again should succeed without error
    nixpi.succeed("systemctl start nixpi-netbird-provisioner.service")

    # Provisioner log should mention groups
    nixpi.succeed("journalctl -u nixpi-netbird-provisioner | grep -i 'bloom-devices'")

    print("NetBird provisioner test passed")
  '';
}
