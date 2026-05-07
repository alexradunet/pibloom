{
  config,
  inputs,
  lib,
  pkgs,
  ...
}: let
  minecraftPlugins = {
    axgraves = pkgs.fetchurl {
      url = "https://cdn.modrinth.com/data/Cz6msz34/versions/rSHiNcdQ/AxGraves-1.28.0.jar";
      hash = "sha256-wVFyFN0rEfchXry4jXv143iqJ6+EAx7sOtHEiaDHMYY=";
    };
    treetimber = pkgs.fetchurl {
      url = "https://cdn.modrinth.com/data/52W2RPUh/versions/3N4S9Ppn/timber-1.8.2.jar";
      hash = "sha256-Jb6o3YUnDARJ8cArgdMOuAdvnlSOVb7VZ12PvWHmq+E=";
    };
    interactionvisualizer = pkgs.fetchurl {
      url = "https://hangarcdn.papermc.io/plugins/LOOHP/InteractionVisualizer/versions/2026.1.1/PAPER/InteractionVisualizer-2026.1.1.0.jar";
      hash = "sha256-i2WUoWtIZ9f9IvQ6hjhfK/s82HSe2g67jUUm8Bp3MNg=";
    };
    simpletpa = pkgs.fetchurl {
      url = "https://hangarcdn.papermc.io/plugins/Jelly-Pudding/SimpleTPA/versions/1.5/PAPER/SimpleTPA-1.5.jar";
      hash = "sha256-GuiE2Z5d09Y1HQgwUo+aicRj+zkGYoFcNy/dZRsU3iA";
    };
  };

  papermc_26_1_2 = pkgs.stdenvNoCC.mkDerivation {
    pname = "papermc";
    version = "26.1.2-60";

    src = pkgs.fetchurl {
      url = "https://fill-data.papermc.io/v1/objects/6a03b365d66c68ad0d4fe843c51183d7cdbfb20fa3d11b2423984648f4bc9e57/paper-26.1.2-60.jar";
      hash = "sha256-agOzZdZsaK0NT+hDxRGD182/sg+j0RskI5hGSPS8nlc=";
    };

    nativeBuildInputs = [pkgs.makeBinaryWrapper];
    dontUnpack = true;
    preferLocalBuild = true;
    allowSubstitutes = false;

    installPhase = ''
      runHook preInstall

      install -D $src $out/share/papermc/papermc.jar
      makeWrapper ${pkgs.jdk25_headless}/bin/java "$out/bin/minecraft-server" \
        --append-flags "-jar $out/share/papermc/papermc.jar nogui" \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [pkgs.udev]}

      runHook postInstall
    '';

    meta = {
      description = "High-performance Minecraft server";
      homepage = "https://papermc.io/";
      mainProgram = "minecraft-server";
    };
  };
in {
  imports = [
    inputs.disko.nixosModules.disko
    ./disk-config.nix
    ./hardware-configuration.nix
    ./networking.nix
    # Host-local private overlays — tracked with placeholder values.
    # Fill in real values locally, then:
    #   git update-index --skip-worktree hosts/nixpi-vps/*.private.nix
    ./networking.private.nix
    ./secrets.private.nix
    ./nixpi-gateway.private.nix
    ./minecraft.private.nix
    ../alex.nix
    inputs.self.nixosModules.server
    inputs.self.nixosModules.service-gateway
    inputs.self.nixosModules.service-code-server
    inputs.self.nixosModules.service-planner
    inputs.self.nixosModules.service-webdav
    inputs.self.nixosModules.service-ollama
  ];

  environment.systemPackages = [
    inputs.codex-cli-nix.packages.${pkgs.stdenv.hostPlatform.system}.default
  ];

  networking.hostName = "nixpi-vps";
  system.stateVersion = "26.05";

  nixpi.secrets.synthetic.sopsFile = ./secrets.yaml;

  # Allow generic dynamically linked Linux binaries such as the VSCodium
  # remote server downloaded by Open Remote - SSH to run on NixOS.
  programs.nix-ld.enable = true;

  boot.loader = {
    grub = {
      enable = true;
      efiSupport = false;
    };
  };
  boot.swraid.mdadmConf = ''
    MAILADDR root
  '';

  systemd = {
    tmpfiles.rules = [
      "L+ /var/lib/minecraft/plugins/AxGraves.jar - - - - ${minecraftPlugins.axgraves}"
      "L+ /var/lib/minecraft/plugins/TreeTimber.jar - - - - ${minecraftPlugins.treetimber}"
      "L+ /var/lib/minecraft/plugins/InteractionVisualizer.jar - - - - ${minecraftPlugins.interactionvisualizer}"
      "L+ /var/lib/minecraft/plugins/SimpleTPA.jar - - - - ${minecraftPlugins.simpletpa}"
    ];

    services.minecraft-world-backup = {
      description = "Backup Minecraft world data";
      serviceConfig = {
        Type = "oneshot";
        User = "minecraft";
        Group = "minecraft";
      };
      path = [
        pkgs.bash
        pkgs.gnutar
        pkgs.gzip
        pkgs.coreutils
        pkgs.findutils
      ];
      script = ''
        set -euo pipefail
        src="/var/lib/minecraft/world"
        dst="/var/lib/minecraft/backups"
        stamp=$(date +%Y%m%d_%H%M%S)

        if [ ! -d "$src" ]; then
          echo "World directory not found, skipping backup"
          exit 0
        fi

        mkdir -p "$dst"
        echo "Saving world before backup..."
        echo "save-all" > /run/minecraft-server.stdin || true
        sleep 5

        archive="$dst/world_''${stamp}.tar.gz"
        echo "Backing up world to ''${archive}"
        tar czf "$archive" -C /var/lib/minecraft world

        # Keep last 7 backups
        find "$dst" -maxdepth 1 -name 'world_*.tar.gz' -type f -printf '%T+ %p\n' \
          | sort -r | tail -n +8 | awk '{print $2}' | xargs -r rm -v

        echo "Backup complete. Current backups:"
        ls -lh "$dst"
      '';
    };

    timers.minecraft-world-backup = {
      wantedBy = ["timers.target"];
      timerConfig = {
        OnCalendar = "*-*-* 03:00:00";
        Persistent = true;
      };
    };
  };

  # Health snapshot — writes wiki memory status to /var/lib/nixpi-wiki-health/
  services.nixpi-health-snapshot = {
    enable = true;
    serviceName = "nixpi-wiki-health-snapshot";
    stateDirectory = "nixpi-wiki-health";
    outFile = "technical.status";
    schedule = "*-*-* 04:15:00";
  };

  # PaperMC server — long-term survival world, ~10 player base
  # Plugins: drop .jar files into /var/lib/minecraft/plugins/ (restart required)
  # WHITELIST MODE: add players in the whitelist block below, then rebuild
  services = {
    nixpi-code-server = {
      enable = true;
      # hashedPassword is provided by hosts/nixpi-vps/secrets.private.nix
      # (gitignored). See secrets.private.nix.example for the format.
    };

    minecraft-server = {
      enable = true;
      eula = true;
      openFirewall = true;
      declarative = true;
      whitelist = {
        # Whitelisted Minecraft players are kept in
        # hosts/nixpi-vps/minecraft.private.nix (tracked with placeholders;
        # use `git update-index --skip-worktree` for local additions).
      };
      package = papermc_26_1_2;
      jvmOpts = lib.concatStringsSep " " [
        "-Xms4G -Xmx8G"
        "-Djava.net.preferIPv4Stack=true"
        # G1GC tuning for low-latency on 8-core VPS
        "-XX:+UseG1GC"
        "-XX:+ParallelRefProcEnabled"
        "-XX:MaxGCPauseMillis=200"
        "-XX:+UnlockExperimentalVMOptions"
        "-XX:+DisableExplicitGC"
        "-XX:+AlwaysPreTouch"
        "-XX:+PerfDisableSharedMem"
      ];
      serverProperties = {
        server-port = 25565;
        difficulty = 2; # normal
        gamemode = 0; # survival
        max-players = 20;
        motd = "NixPI Minecraft — stay humble";
        white-list = true;
        allow-cheats = false;
        spawn-protection = 16;
        view-distance = 10;
        simulation-distance = 8;
        players-sleeping-percentage = 50;
        enable-rcon = false;
        network-compression-threshold = 256;
      };
    };

    openssh = {
      enable = true;
      openFirewall = true;
      settings = {
        PasswordAuthentication = false;
        KbdInteractiveAuthentication = false;
        PermitRootLogin = lib.mkDefault "no";
      };
    };

    nixpi-gateway = {
      enable = true;
      settings = {
        audioTranscription.enabled = true;
        # Route to local ollama when synthetic is unavailable, and expose
        # the ollama provider so proactive tasks can use gemma3:4b.
        localProvider = {
          enable = true;
          # qwen2.5:3b for tool-calling (reliable Hermes 2 Pro template)
          # gemma3:4b is available for prose/summarization tasks
          fallbackModel = "ollama/qwen2.5:3b";
        };
        transports = {
          websocket.enable = true;
          # WhatsApp transport is provided by hosts/nixpi-vps/nixpi-gateway.private.nix
          # (gitignored) — owner phone numbers stay out of the public repo.
          # See nixpi-gateway.private.nix.example for the format.
        };
      };
    };

    nixpi-planner = {
      enable = true;
      # Standards-first planner foundation: CalDAV/iCalendar VTODO.
      # Loopback-only until a TLS/authenticated public access path is chosen.
    };

    nixpi-webdav = {
      enable = true;
      sopsFile = ./secrets.yaml;
      # Loopback-only — access via: ssh -L 4918:127.0.0.1:4918 nixpi-vps
      # then point Joplin WebDAV to http://localhost:4918
    };

    nixpi-ollama = {
      enable = true;
      # VPS has 62 GB RAM — load all three tiers.
      # gemma3:4b  — chat, summarization, multilingual (128K ctx)
      # qwen2.5:3b — reliable tool-calling (native Hermes 2 Pro template)
      # gemma3:1b  — tiny fallback / CI smoke
      models = ["gemma3:4b" "qwen2.5:3b" "gemma3:1b"];
      # CPU-only on a dedicated VPS; acceptable for fallback/background use.
    };

    nixpi-proactive-timers = {
      enable = true;

      tasks = {
        dailyDigest = {
          enable = true;
          schedule = "*-*-* 08:00:00";
          model = "ollama/gemma3:4b";
          fallbackModel = "synthetic/hf:moonshotai/Kimi-K2.6";
          systemPrompt = "You are NixPI, Alex's personal AI assistant. Be concise and proactive.";
          userPrompts = [
            "Good morning Alex! Today is $(date +%Y-%m-%d). Host: ${config.networking.hostName}."
            ""
            "Generate a brief morning digest:"
            "1. nixpi_planner action=list view=overdue — list any overdue items first"
            "2. nixpi_planner action=list view=today — today's tasks and reminders"
            "3. nixpi_planner action=list view=upcoming — next 7 days"
            "4. wiki_search query=project type=project — summarize 1-2 active projects with recent activity"
            "5. Check meta/about-alex/current-context.md and note if anything needs updating"
            "6. Run nixpi-context --health from the shell and flag any anomalies (disk, load, services)"
            ""
            "Format: ⚠️ Overdue | 📋 Today | 📅 Upcoming | 🚀 Projects | 🔧 System"
            "Keep each section to 2-3 bullets. End with: — NixPI"
            "Finally: call wiki_daily action=append to log delivery."
          ];
          enabledTools = "nixpi_planner,wiki_search,wiki_daily";
        };

        weeklyReview = {
          enable = true;
          schedule = "Sun *-*-* 18:00:00";
          systemPrompt = "You are NixPI, Alex's personal AI assistant. Help Alex reflect on the past week.";
          userPrompts = [
            "Weekly review prompt for Alex — $(date +%Y-%m-%d)."
            ""
            "1. wiki_search query=decision type=decision — list decisions made this week"
            "2. wiki_daily action=get — review the last few daily notes for patterns"
            "3. nixpi_planner action=list view=overdue — flag anything slipping"
            "4. Summarize: What got done? What's blocked? What needs a decision?"
            ""
            "Keep it conversational and actionable. Surface the 1-2 most important things for next week."
            "End with: — NixPI"
          ];
          enabledTools = "nixpi_planner,wiki_search,wiki_daily";
        };

        monthlyDecayPass = {
          enable = true;
          schedule = "*-*-01 03:00:00";
          systemPrompt = "You are NixPI, running a scheduled maintenance pass. Be terse and factual.";
          userPrompts = [
            "Monthly wiki decay pass — $(date +%Y-%m-%d)."
            ""
            "1. Run wiki_decay_pass dry_run=false to downgrade stale-confidence pages."
            "2. Run wiki_lint mode=strict and report any new issues."
            "3. List the top 5 confidence:low pages from wiki_search that need review or archiving."
            ""
            "Log results with wiki_daily action=append to record the pass."
          ];
          enabledTools = "wiki_decay_pass,wiki_lint,wiki_search,wiki_daily,wiki_rebuild";
        };
      };
    };
  };

  # Safe specialisation: disable VPS-specific services for recovery boots.
  specialisation.safe.configuration = {
  };
}
