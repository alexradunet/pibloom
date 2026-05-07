_: {
  ownloom = {
    root = "/home/alex/ownloom";

    human = {
      name = "alex";
      homeDirectory = "/home/alex";
    };

    owner = {
      displayName = "Alex";
      sshKeys = [
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIENtAScWjs7J3zEBQLhz5totmYIR7BMrXcQuJ6ZzJ/US alex@nixos-laptop"
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA3Y9CznTy1cKcJ56BxZeEK67CSJGjl1VtMb3wx3ziaA alex@vps-nixos"
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBEWQSCmHKdaiccFA7Mp+MMfq8V9dpYpEJ+7h6Hj+4vg alex@windows-medius"
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPrEmvcVkdFAvLqEjbsXBOhpjFXtsUDjnQaPecRBrqpz"
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPb6MPMpCqj8MRWe+qCVnZNA5a004Vdk+q2v3/xoL+x+"
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGA8BNch1xK3NZ2ARQmIHLqM2/rydIYVO4bekW2ux7+f alex@nixos"
      ];
    };

    pi = {
      extensions = [
        "ownloom"
      ];

      packages = [
        "git:github.com/aliou/pi-synthetic@v0.15.0"
      ];
    };

    primaryUser.extraGroups = [
      "wheel"
    ];
  };
}
