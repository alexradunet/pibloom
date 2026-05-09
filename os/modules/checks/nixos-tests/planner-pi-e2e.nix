{pkgs, ...}: let
  # Fake LLM server: speaks OpenAI chat-completions (streaming + non-streaming).
  # Turn 1 → ownloom_planner add_task tool call.
  # Turn 2 → short confirmation text.
  fakeLlmScript = pkgs.python3.pkgs.buildPythonApplication {
    pname = "fake-llm";
    version = "0";
    format = "other";
    src = ./fake-llm.py;
    dontUnpack = true;
    installPhase = ''
      install -Dm755 $src $out/bin/fake-llm
    '';
  };

  # Extension source tree: copy os/pkgs/ without node_modules so that the
  # extension's relative import of ../../../../ownloom-wiki/src/api.ts resolves.
  ownloomPkgs =
    builtins.filterSource
    (path: type: type != "directory" || builtins.baseNameOf path != "node_modules")
    ../../../pkgs;
  ownloomExt = "${ownloomPkgs}/pi-adapter/extension";

  # models.json teaching pi to use our fake provider on 127.0.0.1:11434.
  modelsJson = pkgs.writeText "models.json" (builtins.toJSON {
    providers.fake-llm = {
      baseUrl = "http://127.0.0.1:11434/v1";
      api = "openai-completions";
      apiKey = "fake";
      compat = {
        supportsDeveloperRole = false;
        supportsReasoningEffort = false;
      };
      models = [
        {
          id = "test:latest";
          name = "Fake Test Model";
          reasoning = false;
          input = ["text"];
          contextWindow = 4096;
          maxTokens = 1024;
          cost = {
            input = 0;
            output = 0;
            cacheRead = 0;
            cacheWrite = 0;
          };
        }
      ];
    };
  });
in
  pkgs.testers.runNixOSTest {
    name = "planner-pi-e2e";

    nodes.vm = {...}: {
      imports = [
        ../../features/nixos/paths/module.nix
        ../../features/nixos/service-planner/module.nix
      ];

      networking.hostName = "planner-pi-e2e-test";
      system.stateVersion = "26.05";

      services.ownloom-planner.enable = true;

      # Fake LLM server on the same port as ollama so pi's provider routing
      # is identical to production.
      systemd.services.fake-llm = {
        description = "Fake OpenAI-compatible LLM for integration tests";
        wantedBy = ["multi-user.target"];
        after = ["network.target"];
        serviceConfig = {
          Type = "simple";
          ExecStart = "${fakeLlmScript}/bin/fake-llm";
          Restart = "on-failure";
        };
      };

      environment.systemPackages = [
        pkgs.pi
        pkgs.ownloom-planner
        pkgs.curl
      ];
    };

    testScript = ''
      vm.start()

      # Wait for both backend services.
      vm.wait_for_unit("radicale.service")
      vm.wait_for_unit("fake-llm.service")
      vm.wait_for_open_port(5232)   # radicale
      vm.wait_for_open_port(11434)  # fake-llm

      # Confirm fake-llm speaks the ollama API.
      vm.succeed("curl -sf http://127.0.0.1:11434/api/tags | grep -q 'models'")

      # Set up the pi working environment.
      vm.succeed("mkdir -p /root/.pi/agent /tmp/wiki")
      vm.succeed("cp ${modelsJson} /root/.pi/agent/models.json")

      env = " ".join([
          "HOME=/root",
          "PI_CODING_AGENT_DIR=/root/.pi/agent",
          "OWNLOOM_WIKI_ROOT=/tmp/wiki",
          "OWNLOOM_WIKI_WORKSPACE=test",
          "OWNLOOM_WIKI_DEFAULT_DOMAIN=technical",
          "OWNLOOM_PLANNER_CALDAV_URL=http://127.0.0.1:5232/",
          "OWNLOOM_PLANNER_USER=human",
          "OWNLOOM_PLANNER_COLLECTION=planner",
          "OWNLOOM_PLANNER_BACKEND=caldav-radicale",
          "NODE_PATH=${pkgs.pi}/lib/node_modules/@earendil-works/pi-coding-agent/node_modules:${pkgs.pi}/lib/node_modules",
      ])

      # Initialise the CalDAV collection before pi runs (the extension lists
      # upcoming items during session_start).
      vm.succeed(
          "OWNLOOM_PLANNER_CALDAV_URL=http://127.0.0.1:5232/ "
          "OWNLOOM_PLANNER_USER=human "
          "OWNLOOM_PLANNER_COLLECTION=planner "
          "ownloom-planner init"
      )

      # Run pi: ask it to add a planner task. The fake LLM returns a
      # ownloom_planner tool call; pi executes it against real Radicale.
      out = vm.succeed(
          f"{env} pi"
          " --extension ${ownloomExt}"
          " --provider fake-llm"
          " --model test:latest"
          " --print"
          " --no-session"
          " 'Add a task called E2E test task due 2026-06-01'"
      )
      print(f"pi output: {out}")

      # The fake LLM confirmed the task in its turn-2 reply.
      assert "E2E test task" in out or "Added" in out or "Done" in out, \
          f"Expected confirmation in pi output, got: {out!r}"

      # The ICS file must be in Radicale's storage.
      vm.succeed(
          "find /var/lib/ownloom-planner/radicale/collections -name '*.ics' | grep ."
      )

      # Verify the task title is in the ICS.
      vm.succeed(
          "grep -r 'E2E test task' /var/lib/ownloom-planner/radicale/collections/"
      )
    '';
  }
