{pkgs, ...}:
pkgs.testers.runNixOSTest {
  name = "webdav-wiki";

  nodes.webdav = {lib, ...}: {
    imports = [
      (_: {
        options.sops = lib.mkOption {
          type = lib.types.attrs;
          default = {};
        };
      })
      ../../features/nixos/paths/module.nix
      ../../features/nixos/service-webdav/module.nix
    ];

    networking.hostName = "webdav-wiki-test";
    system.stateVersion = "26.05";

    users.users.human = {
      isNormalUser = true;
      group = "users";
      home = "/home/human";
      createHome = true;
    };

    environment.systemPackages = [pkgs.curl];
    environment.etc."ownloom-webdav.htpasswd".text = "human:{SHA}qUqP5cyxm6YcTAhz05Hph5gvu9M=\n";

    services.ownloom-webdav = {
      enable = true;
      htpasswdFile = "/etc/ownloom-webdav.htpasswd";
      metadataRebuildInterval = "0";
    };
  };

  testScript = ''
    webdav.start()
    webdav.wait_for_unit("nginx.service")
    webdav.wait_for_open_port(4918)

    # Unauthenticated clients must not get access.
    webdav.succeed("test $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4918/) = 401")

    # WebDAV discovery works with Basic auth.
    webdav.succeed("test $(curl -s -o /tmp/propfind.xml -w '%{http_code}' -u human:test -X PROPFIND http://127.0.0.1:4918/ -H 'Depth: 1') = 207")

    # PUT creates intermediate directories, GET reads the file, DELETE removes it.
    webdav.succeed("printf '# WebDAV wiki smoke\\n' > /tmp/webdav-smoke.md")
    webdav.succeed("curl -s -f -u human:test -T /tmp/webdav-smoke.md http://127.0.0.1:4918/objects/webdav-smoke.md")
    webdav.succeed("test -f /home/human/wiki/objects/webdav-smoke.md")
    webdav.succeed("curl -s -f -u human:test http://127.0.0.1:4918/objects/webdav-smoke.md | grep -q 'WebDAV wiki smoke'")
    webdav.succeed("curl -s -f -u human:test -X DELETE http://127.0.0.1:4918/objects/webdav-smoke.md")
    webdav.fail("test -e /home/human/wiki/objects/webdav-smoke.md")
  '';
}
