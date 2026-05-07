{
  config,
  lib,
  pkgs,
  utils,
  ...
}: let
  cfg = config.services.nixpi-gateway;
  inherit (cfg) settings;
  inherit (settings.transports) whatsapp;
  yamlFormat = pkgs.formats.yaml {};
  defaultWhatsAppModel = "hf:moonshotai/Kimi-K2.6";
  normalizeSyntheticModel = model: lib.removePrefix "synthetic/" model;
  whatsappTrustedNumbers = lib.unique (whatsapp.ownerNumbers ++ whatsapp.trustedNumbers);
  whatsappAdminNumbers = lib.unique (whatsapp.ownerNumbers ++ whatsapp.adminNumbers);
  whatsappAllowedModels = map normalizeSyntheticModel whatsapp.allowedModels;
  stateDirectory = lib.removePrefix "/var/lib/" cfg.stateDir;
  humanHome = config.nixpi.human.homeDirectory;
  permissionTightenScript = pkgs.writeShellScript "nixpi-gateway-tighten-permissions" ''
    set -eu
    for path in ${lib.escapeShellArgs [cfg.stateDir "${humanHome}/.pi/agent" "${humanHome}/.pi/agent-memory"]}; do
      if [ -e "$path" ]; then
        ${pkgs.coreutils}/bin/chmod -R u+rwX,go-rwx "$path"
      fi
    done
  '';
  defaultWhisperModel = pkgs.fetchurl {
    url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
    hash = "sha256-YO1bw90U7qhWST0zQ0m0BXgt3K8AKNS130CINF+6Lv4=";
  };

  gatewayConfig = yamlFormat.generate "nixpi-gateway.yml" {
    gateway = {
      inherit (settings.gateway) statePath;
      inherit (settings.gateway) sessionDir;
      inherit (settings.gateway) maxReplyChars;
      inherit (settings.gateway) maxReplyChunks;
    };

    audioTranscription = {
      inherit (settings.audioTranscription) enabled;
      inherit (settings.audioTranscription) command;
      inherit (settings.audioTranscription) ffmpegCommand;
      inherit (settings.audioTranscription) modelPath;
      inherit (settings.audioTranscription) language;
      inherit (settings.audioTranscription) threads;
      inherit (settings.audioTranscription) timeoutMs;
      inherit (settings.audioTranscription) maxSeconds;
    };
    pi = {
      inherit (settings.pi) cwd;
      inherit (settings.pi) agentDir;
      inherit (settings.pi) timeoutMs;
    };
    transports =
      lib.optionalAttrs whatsapp.enable {
        whatsapp = {
          enabled = true;
          trustedNumbers = whatsappTrustedNumbers;
          adminNumbers = whatsappAdminNumbers;
          inherit (whatsapp) directMessagesOnly;
          inherit (whatsapp) sessionDataPath;
          inherit (whatsapp) model;
          inherit (whatsapp) allowedModels;
        };
      }
      // lib.optionalAttrs settings.transports.websocket.enable {
        websocket =
          {
            enabled = true;
            inherit (settings.transports.websocket) host;
            inherit (settings.transports.websocket) port;
          }
          // lib.optionalAttrs (settings.transports.websocket.staticDir != null) {
            inherit (settings.transports.websocket) staticDir;
          }
          // lib.optionalAttrs (settings.transports.websocket.authToken != null) {
            inherit (settings.transports.websocket) authToken;
          };
      };
  };
in {
  imports = [../nixpi-paths/module.nix];

  options.services.nixpi-gateway = {
    enable = lib.mkEnableOption "NixPI generic transport gateway";

    package = lib.mkPackageOption pkgs "nixpi-gateway" {};

    stateDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/nixpi-gateway";
      description = "Directory for gateway database, sessions, and runtime state.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = config.nixpi.human.name;
      defaultText = lib.literalExpression "config.nixpi.human.name";
      description = "User account that runs the gateway. Defaults to the primary NixPI human/operator user.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "users";
      description = "Group for the gateway service.";
    };

    syntheticApiKeyFile = lib.mkOption {
      type = lib.types.str;
      default = "/run/secrets/synthetic_api_key";
      description = "Runtime file containing the Synthetic API key for Pi prompts.";
    };

    extraReadWritePaths = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Additional filesystem paths the gateway systemd service may write. Only needed when ProtectSystem is enabled.";
    };

    settings = {
      gateway = {
        statePath = lib.mkOption {
          type = lib.types.str;
          default = "${cfg.stateDir}/gateway-state.json";
          description = "Path to the gateway operational state file (dedup cache, session tracking).";
        };

        sessionDir = lib.mkOption {
          type = lib.types.str;
          default = "${cfg.stateDir}/sessions";
          description = "Directory for Pi session state.";
        };

        maxReplyChars = lib.mkOption {
          type = lib.types.int;
          default = 1400;
          description = "Maximum characters per reply chunk.";
        };

        maxReplyChunks = lib.mkOption {
          type = lib.types.int;
          default = 4;
          description = "Maximum number of reply chunks to send per message.";
        };
      };

      audioTranscription = {
        enabled = lib.mkEnableOption "local Whisper speech-to-text for WhatsApp audio messages";

        command = lib.mkOption {
          type = lib.types.str;
          default = "${pkgs.whisper-cpp}/bin/whisper-cli";
          description = "Absolute path to the whisper.cpp CLI used for audio transcription.";
        };

        ffmpegCommand = lib.mkOption {
          type = lib.types.str;
          default = "${pkgs.ffmpeg}/bin/ffmpeg";
          description = "Absolute path to ffmpeg used to normalize WhatsApp audio before transcription.";
        };

        modelPath = lib.mkOption {
          type = lib.types.str;
          default = toString defaultWhisperModel;
          description = "Path to the whisper.cpp ggml model used for transcription.";
        };

        language = lib.mkOption {
          type = lib.types.str;
          default = "auto";
          description = "Spoken language passed to whisper.cpp; use `auto` for detection.";
        };

        threads = lib.mkOption {
          type = lib.types.int;
          default = 4;
          description = "Number of CPU threads passed to whisper.cpp.";
        };

        timeoutMs = lib.mkOption {
          type = lib.types.int;
          default = 120000;
          description = "Timeout in milliseconds for each audio transcription.";
        };

        maxSeconds = lib.mkOption {
          type = lib.types.int;
          default = 180;
          description = "Maximum WhatsApp audio duration in seconds accepted for transcription.";
        };
      };

      pi = {
        cwd = lib.mkOption {
          type = lib.types.str;
          default = config.nixpi.root;
          defaultText = lib.literalExpression "config.nixpi.root";
          description = "Working directory for pi sessions. Defaults to the NixPI root.";
        };

        agentDir = lib.mkOption {
          type = lib.types.str;
          default = "${humanHome}/.pi/agent";
          defaultText = lib.literalExpression ''"${config.nixpi.human.homeDirectory}/.pi/agent"'';
          description = "Pi SDK agent directory used for settings, credentials, sessions, and extension discovery.";
        };

        timeoutMs = lib.mkOption {
          type = lib.types.int;
          default = 300000;
          description = "Timeout in milliseconds for each Pi SDK prompt call.";
        };
      };

      wiki = {
        dir = lib.mkOption {
          type = lib.types.str;
          default = config.nixpi.wiki.root;
          defaultText = lib.literalExpression "config.nixpi.wiki.root";
          description = "Single wiki root exposed to Pi gateway sessions.";
        };
      };

      transports = {
        websocket = {
          enable = lib.mkEnableOption "WebSocket transport — exposes a streaming chat WebSocket and optionally serves a static web UI";

          host = lib.mkOption {
            type = lib.types.str;
            default = "127.0.0.1";
            description = "Host to bind. Keep loopback-only unless explicitly fronted by a trusted reverse proxy.";
          };

          port = lib.mkOption {
            type = lib.types.port;
            default = 8081;
            description = "Port for the WebSocket transport.";
          };

          staticDir = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Optional path to a built web UI to serve over HTTP. When unset the gateway serves the bundled-in NixPI cockpit. This option is only needed for a custom dev build or external UI.";
          };

          authToken = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Pre-shared token clients must send as their first WebSocket message. Null disables auth (safe when the only access path is a trusted SSH port-forward).";
          };
        };

        whatsapp = {
          enable = lib.mkEnableOption "WhatsApp transport for nixpi-gateway";

          ownerNumbers = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [];
            description = ''
              WhatsApp phone numbers in E.164 format that are both trusted and
              admins. For a single-owner personal gateway, set only this option.
            '';
          };

          trustedNumbers = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [];
            description = "Additional WhatsApp phone numbers in E.164 format allowed to message Pi.";
          };

          adminNumbers = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [];
            description = "Additional WhatsApp phone numbers with admin access (subset of trustedNumbers plus ownerNumbers).";
          };

          directMessagesOnly = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "When true, only direct WhatsApp messages are handled (no group chats).";
          };

          sessionDataPath = lib.mkOption {
            type = lib.types.str;
            default = "${cfg.stateDir}/whatsapp/auth";
            description = "Directory used by the WhatsApp transport to persist Baileys auth state and QR artifacts.";
          };

          model = lib.mkOption {
            type = lib.types.str;
            default = defaultWhatsAppModel;
            example = "hf:moonshotai/Kimi-K2.6";
            description = ''
              Synthetic model used for every WhatsApp Pi prompt.
              Accepts either a bare Synthetic model id such as
              `hf:moonshotai/Kimi-K2.6` or the full Pi model selector form
              `synthetic/hf:moonshotai/Kimi-K2.6`.
            '';
          };

          allowedModels = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [defaultWhatsAppModel];
            example = [
              "hf:moonshotai/Kimi-K2.6"
              "hf:deepseek-ai/DeepSeek-V3.2"
            ];
            description = ''
              Synthetic model ids exposed to WhatsApp Pi sessions. The selected
              `services.nixpi-gateway.settings.transports.whatsapp.model` must be in this list.
            '';
          };
        };
      };

      localProvider = {
        enable = lib.mkEnableOption "local LLM fallback provider for gateway failover";

        baseUrl = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:11434/v1";
          description = "Base URL of the local OpenAI-compatible LLM server (e.g. ollama).";
        };

        apiKey = lib.mkOption {
          type = lib.types.str;
          default = "ollama";
          description = "API key sent to the local server (ignored by ollama).";
        };

        models = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = ["qwen2.5:3b" "gemma3:4b" "gemma3:1b"];
          description = "Model IDs to register in models.json for the local ollama provider.";
        };

        fallbackModel = lib.mkOption {
          type = lib.types.str;
          default = "ollama/qwen2.5:3b";
          description = "Pi model selector (provider/model-id) used as fallback when the primary provider fails.";
        };
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.enable -> cfg.user != "";
        message = "services.nixpi-gateway.user must be set when the gateway is enabled.";
      }
      {
        assertion = cfg.enable -> cfg.group != "";
        message = "services.nixpi-gateway.group must be set when the gateway is enabled.";
      }
      {
        assertion = cfg.enable -> settings.pi.cwd != "";
        message = "services.nixpi-gateway.settings.pi.cwd must be set when the gateway is enabled.";
      }
      {
        assertion = lib.hasPrefix "/var/lib/" cfg.stateDir;
        message = "services.nixpi-gateway.stateDir must be under /var/lib when the gateway is enabled.";
      }
      {
        assertion =
          settings.transports.websocket.enable
          -> (settings.transports.websocket.host == "127.0.0.1" || settings.transports.websocket.host == "::1");
        message = "services.nixpi-gateway.settings.transports.websocket.host must stay loopback-only.";
      }
      {
        assertion = whatsapp.enable -> whatsappTrustedNumbers != [];
        message = "services.nixpi-gateway.settings.transports.whatsapp.ownerNumbers or trustedNumbers must not be empty when whatsapp transport is enabled.";
      }
      {
        assertion =
          whatsapp.enable
          -> lib.all (number: builtins.match "^\\+[0-9]+$" number != null) whatsappTrustedNumbers;
        message = "services.nixpi-gateway.settings.transports.whatsapp numbers must use E.164 format, e.g. +15550001111.";
      }
      {
        assertion =
          whatsapp.enable
          -> lib.all (number: builtins.elem number whatsappTrustedNumbers) whatsappAdminNumbers;
        message = "services.nixpi-gateway.settings.transports.whatsapp.adminNumbers must be included in ownerNumbers or trustedNumbers.";
      }
      {
        assertion =
          whatsapp.enable
          -> builtins.elem (normalizeSyntheticModel whatsapp.model) whatsappAllowedModels;
        message = "services.nixpi-gateway.settings.transports.whatsapp.model must be included in services.nixpi-gateway.settings.transports.whatsapp.allowedModels.";
      }
    ];

    systemd.services.nixpi-gateway = {
      description = "NixPI generic transport gateway";
      after = ["network.target"];
      wantedBy = ["multi-user.target"];
      path = [
        pkgs.pi
        pkgs.coreutils
        pkgs.findutils
        pkgs.gnugrep
        pkgs.ripgrep
        pkgs.fd
        pkgs.git
        pkgs.openssh
        pkgs.nodejs
        pkgs.nixos-rebuild
        pkgs.podman
        pkgs.nixpi-health
        pkgs.nixpi-status
      ];
      environment =
        {
          HOME = humanHome;
          XDG_CONFIG_HOME = "${cfg.stateDir}/xdg/config";
          XDG_CACHE_HOME = "${cfg.stateDir}/xdg/cache";
          PI_CODING_AGENT_DIR = settings.pi.agentDir;
          NIXPI_WIKI_ROOT = settings.wiki.dir;
          NIXPI_WIKI_WORKSPACE = config.nixpi.wiki.workspace;
          NIXPI_WIKI_DEFAULT_DOMAIN = config.nixpi.wiki.defaultDomain;
          NIXPI_WIKI_HOST = config.networking.hostName;
          PI_SYNTHETIC_API_KEY_FILE = "%d/synthetic_api_key";
        }
        // config.nixpi.plannerEnvVars
        // lib.optionalAttrs settings.localProvider.enable {
          NIXPI_LOCAL_PROVIDER_MODEL = settings.localProvider.fallbackModel;
        };

      serviceConfig = let
        writeModelsJsonScript = let
          modelsJson = pkgs.writeText "nixpi-gateway-models.json" (
            builtins.toJSON {
              providers.ollama = {
                inherit (settings.localProvider) baseUrl apiKey;
                api = "openai-completions";
                compat = {
                  supportsDeveloperRole = false;
                  supportsReasoningEffort = false;
                };
                models = map (id: {inherit id;}) settings.localProvider.models;
              };
            }
          );
        in
          pkgs.writeShellScript "nixpi-gateway-write-models-json" ''
            set -eu
            mkdir -p ${lib.escapeShellArg settings.pi.agentDir}
            cp ${modelsJson} ${lib.escapeShellArg settings.pi.agentDir}/models.json
            echo "nixpi-gateway: wrote models.json (fallback: ${settings.localProvider.fallbackModel})" >&2
          '';
      in {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = settings.pi.cwd;
        ExecStartPre = [permissionTightenScript] ++ lib.optionals settings.localProvider.enable [writeModelsJsonScript];
        ExecStart = utils.escapeSystemdExecArgs ["${cfg.package}/bin/nixpi-gateway" gatewayConfig];
        Restart = "on-failure";
        RestartSec = "10s";
        StandardOutput = "journal";
        StandardError = "journal";
        SyslogIdentifier = "nixpi-gateway";
        LoadCredential = ["synthetic_api_key:${cfg.syntheticApiKeyFile}"];
        StateDirectory =
          [
            stateDirectory
            "${stateDirectory}/sessions"
          ]
          ++ lib.optionals whatsapp.enable [
            "${stateDirectory}/whatsapp"
            "${stateDirectory}/whatsapp/auth"
          ];
        StateDirectoryMode = "0700";
        CacheDirectory = stateDirectory;
        CacheDirectoryMode = "0700";
        RuntimeDirectory = "nixpi-gateway";
        RuntimeDirectoryMode = "0700";
        UMask = "0077";

        # Hardening — intentionally light so that the gateway can run
        # privileged operations (nixos-rebuild, systemctl, etc.) via sudo
        # on behalf of the trusted operator. Security relies on the
        # strict owner allowlist (ownerNumbers) and the agent's
        # confirmation-before-action system prompt.
        NoNewPrivileges = false;
        PrivateTmp = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = false; # node requires JIT
      };
    };
  };
}
