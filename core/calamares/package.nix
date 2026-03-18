# core/calamares/package.nix
# Custom calamares-nixos-extensions override for Bloom OS.
# Replaces the standard nixos install module with bloom_nixos and adds bloom_prefill.
#
# upstreamCalamares must be the PRE-OVERLAY calamares-nixos-extensions (i.e. prev.*
# in the nixpkgs overlay). Passing the post-overlay value causes infinite recursion.
{ pkgs, upstreamCalamares }:

upstreamCalamares.overrideAttrs (old: {
  src = pkgs.runCommand "bloom-calamares-src" {} ''
    # Start from the upstream package source
    cp -r ${old.src} $out
    chmod -R u+w $out

    # Replace the standard nixos module with our bloom_nixos module
    rm -rf $out/modules/nixos
    cp -r ${./bloom_nixos} $out/modules/bloom-nixos
    chmod -R u+w $out/modules/bloom-nixos

    # Bundle the repo's flake.lock alongside the bloom_nixos module.
    # The installer copies this to /mnt/etc/nixos/flake.lock so that
    # `nix build` evaluates the same derivation hashes as the ISO, allowing
    # bloom-app and piAgent (pre-built into the ISO squashfs) to be reused
    # from the host store without downloading the Rust toolchain.
    cp ${../../flake.lock} $out/modules/bloom-nixos/flake.lock

    # Add the bloom_prefill module
    cp -r ${./bloom_prefill} $out/modules/bloom-prefill
    chmod -R u+w $out/modules/bloom-prefill


    # Override Calamares config with our sequence and module configs.
    # installPhase copies config/* → etc/calamares/ and does @out@ substitution,
    # so settings.conf must live at config/settings.conf in the source tree.
    cp ${./config/bloom-settings.conf} $out/config/settings.conf
    # Module-specific configs belong in config/modules/ (→ etc/calamares/modules/)
    cp ${./config/bloom-nixos.conf}    $out/config/modules/bloom-nixos.conf
    cp ${./config/users.conf}          $out/config/modules/users.conf
  '';
})
