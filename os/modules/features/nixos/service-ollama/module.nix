{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.ownloom-ollama;

  # Map the acceleration name to the correct nixpkgs ollama variant.
  # "null" means CPU (the default ollama package).
  ollamaPackage =
    if cfg.acceleration == null
    then pkgs.ollama
    else if cfg.acceleration == "cuda"
    then pkgs.ollama-cuda
    else if cfg.acceleration == "rocm"
    then pkgs.ollama-rocm
    else if cfg.acceleration == "vulkan"
    then pkgs.ollama-vulkan
    else pkgs.ollama;
in {
  options.services.ownloom-ollama = {
    enable = lib.mkEnableOption "ownloom local-LLM backend via ollama";

    models = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = ["gemma3:1b"];
      example = ["gemma3:4b" "qwen2.5:3b" "gemma3:1b"];
      description = ''
        Models to pull declaratively via ollama.
        Kept in sync by ollama-model-loader.service (removed if not listed).
      '';
    };

    acceleration = lib.mkOption {
      type = lib.types.nullOr (lib.types.enum [false "rocm" "cuda" "vulkan"]);
      default = null;
      description = ''
        Hardware acceleration backend for ollama.
        null = auto-detect (CPU on hosts without a recognised GPU package).
        Override per-host: "cuda" for NVIDIA, "rocm" for AMD, "vulkan" for generic GPU.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    services.ollama = {
      enable = true;
      package = ollamaPackage;
      host = "127.0.0.1";
      port = 11434;
      openFirewall = false;
      loadModels = cfg.models;
      syncModels = true;
    };

    # Expose the loopback endpoint to shell sessions and downstream services.
    environment.sessionVariables = {
      OWNLOOM_LLM_BASE_URL = "http://127.0.0.1:11434/v1";
      OWNLOOM_LLM_PROVIDER = "ollama";
    };
  };
}
