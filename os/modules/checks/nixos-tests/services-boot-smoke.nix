{pkgs, ...}:
pkgs.testers.runNixOSTest {
  name = "ownloom-services-boot-smoke";

  nodes.vm = {...}: {
    imports = [
      ../../features/nixos/paths/module.nix
      ../../features/nixos/service-planner/module.nix
      ../../features/nixos/service-ollama/module.nix
    ];

    networking.hostName = "ownloom-boot-smoke";
    system.stateVersion = "26.05";

    services.ownloom-planner.enable = true;

    # No models: only test service health, not inference.
    services.ownloom-ollama = {
      enable = true;
      models = [];
    };
  };

  testScript = ''
    vm.start()

    # Both services must reach active state together without conflicting.
    vm.wait_for_unit("radicale.service")
    vm.wait_for_unit("ollama.service")

    vm.wait_for_open_port(5232)   # radicale / CalDAV
    vm.wait_for_open_port(11434)  # ollama / OpenAI-compat

    # Planner CalDAV endpoint responds (302 redirect is normal for the root path).
    vm.succeed("curl -sf -L -u : http://127.0.0.1:5232/.well-known/caldav -o /dev/null -w '%{http_code}' | grep -qE '2[0-9][0-9]|3[0-9][0-9]' || curl -s http://127.0.0.1:5232/ -o /dev/null -w '%{http_code}' | grep -qE '[23][0-9][0-9]'")

    # Ollama OpenAI-compat endpoint responds.
    vm.succeed("curl -sf http://127.0.0.1:11434/v1/models | grep -q 'object'")

    # Both OWNLOOM_PLANNER_* and OWNLOOM_LLM_* session vars are declared.
    vm.succeed("grep -q OWNLOOM_PLANNER_CALDAV_URL /etc/set-environment")
    vm.succeed("grep -q OWNLOOM_LLM_BASE_URL /etc/set-environment")
  '';
}
