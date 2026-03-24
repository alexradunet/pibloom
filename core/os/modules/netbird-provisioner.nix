{ pkgs, config, lib, ... }:

let
  cfg = config.nixpi.netbird;

  provisionerScript = pkgs.writeText "nixpi-netbird-provisioner.py" ''
    import json
    import sys
    import urllib.error
    import urllib.request


    TOKEN_FILE = sys.argv[1]
    BASE_URL = sys.argv[2]
    CONFIG_FILE = sys.argv[3]


    def log(message):
        print(f"[netbird] {message}", flush=True)


    def fail(message):
        raise RuntimeError(message)


    with open(TOKEN_FILE, encoding="utf-8") as handle:
        token = handle.read().strip()
    if not token:
        fail(f"API token file is empty: {TOKEN_FILE}")

    with open(CONFIG_FILE, encoding="utf-8") as handle:
        desired = json.load(handle)

    HEADERS = {
        "Authorization": f"Token {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


    def api(method, path, body=None):
        url = BASE_URL.rstrip("/") + path
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = response.read()
        except urllib.error.HTTPError as error:
            error_body = error.read().decode("utf-8", errors="replace")
            log(f"{method} {path} -> HTTP {error.code}: {error_body}")
            raise

        if not payload:
            return None
        return json.loads(payload)


    def require_id(mapping, kind, name):
        value = mapping.get(name)
        if value:
            return value
        fail(f"Referenced {kind} '{name}' was not found in provisioner state")


    def sorted_strings(values):
        return sorted(values or [])


    def posture_check_min_version(check):
        checks = check.get("checks", {})
        version_check = checks.get("nb_version_check", {})
        return version_check.get("min_version", "")


    def normalize_policy(policy):
        rules = policy.get("rules") or []
        rule = rules[0] if rules else {}
        return {
            "name": policy.get("name", ""),
            "protocol": rule.get("protocol", ""),
            "ports": sorted_strings(rule.get("ports", [])),
            "sources": sorted_strings(rule.get("sources", [])),
            "destinations": sorted_strings(rule.get("destinations", [])),
            "source_posture_checks": sorted_strings(policy.get("source_posture_checks", [])),
            "enabled": bool(policy.get("enabled", True)),
            "rule_enabled": bool(rule.get("enabled", True)),
            "action": rule.get("action", ""),
            "bidirectional": bool(rule.get("bidirectional", False)),
        }


    def normalize_dns_nameserver(entry):
        nameservers = entry.get("nameservers") or []
        primary = nameservers[0] if nameservers else {}
        return {
            "domain": (entry.get("domains") or [""])[0],
            "groups": sorted_strings(entry.get("groups", [])),
            "ip": primary.get("ip", ""),
            "ns_type": primary.get("ns_type", ""),
            "port": primary.get("port"),
            "enabled": bool(entry.get("enabled", True)),
            "search_domains_enabled": bool(entry.get("search_domains_enabled", False)),
        }


    existing_groups = {group["name"]: group for group in api("GET", "/api/groups") or []}
    group_name_to_id = {name: group["id"] for name, group in existing_groups.items()}

    for group_name in desired["groups"]:
        if group_name == "All":
            builtin = existing_groups.get("All", {})
            if builtin.get("id"):
                group_name_to_id["All"] = builtin["id"]
            continue
        if group_name in existing_groups:
            log(f"Creating group: {group_name} ... \u2713 (already existed)")
            group_name_to_id[group_name] = existing_groups[group_name]["id"]
            continue
        result = api("POST", "/api/groups", {"name": group_name}) or {}
        group_name_to_id[group_name] = result.get("id", "")
        if not group_name_to_id[group_name]:
            fail(f"Group creation for '{group_name}' did not return an id")
        log(f"Creating group: {group_name} ... \u2713")

    existing_keys = {key["name"]: key for key in api("GET", "/api/setup-keys") or []}

    for setup_key in desired["setupKeys"]:
        name = setup_key["name"]
        if name in existing_keys:
            log(
                "Creating setup key: "
                f"{name} ... \u2713 (already existed — to change config, revoke in dashboard)"
            )
            continue
        auto_group_ids = [
            require_id(group_name_to_id, "group", group_name)
            for group_name in setup_key["autoGroups"]
        ]
        api(
            "POST",
            "/api/setup-keys",
            {
                "name": name,
                "type": "reusable",
                "auto_groups": auto_group_ids,
                "ephemeral": setup_key["ephemeral"],
                "usage_limit": setup_key["usageLimit"],
            },
        )
        log(f"Creating setup key: {name} ... \u2713")

    existing_checks = {check["name"]: check for check in api("GET", "/api/posture-checks") or []}
    check_name_to_id = {}

    for check in desired["postureChecks"]:
        name = check["name"]
        body = {
            "name": name,
            "checks": {"nb_version_check": {"min_version": check["minVersion"]}},
        }
        existing = existing_checks.get(name)
        if existing is not None:
            existing_id = existing.get("id", "")
            if not existing_id:
                fail(f"Posture check '{name}' exists without an id")
            check_name_to_id[name] = existing_id
            if posture_check_min_version(existing) == check["minVersion"]:
                log(f"Creating posture check: {name} ... \u2713 (already existed)")
                continue
            api("PUT", f"/api/posture-checks/{existing_id}", body)
            log(f"Creating posture check: {name} ... \u2713 (updated)")
            continue
        result = api("POST", "/api/posture-checks", body) or {}
        check_name_to_id[name] = result.get("id", "")
        if not check_name_to_id[name]:
            fail(f"Posture check creation for '{name}' did not return an id")
        log(f"Creating posture check: {name} ... \u2713")

    existing_policies = {policy["name"]: policy for policy in api("GET", "/api/policies") or []}

    for policy in desired["policies"]:
        name = policy["name"]
        body = {
            "name": name,
            "enabled": True,
            "rules": [
                {
                    "name": name,
                    "enabled": True,
                    "action": "accept",
                    "bidirectional": True,
                    "protocol": policy["protocol"],
                    "ports": policy.get("ports", []),
                    "sources": [require_id(group_name_to_id, "group", policy["sourceGroup"])],
                    "destinations": [require_id(group_name_to_id, "group", policy["destGroup"])],
                }
            ],
            "source_posture_checks": [
                require_id(check_name_to_id, "posture check", check_name)
                for check_name in policy.get("postureChecks", [])
            ],
        }
        existing = existing_policies.get(name)
        if existing is not None:
            existing_id = existing.get("id", "")
            if not existing_id:
                fail(f"Policy '{name}' exists without an id")
            if normalize_policy(existing) == normalize_policy(body):
                log(f"Creating policy: {name} ... \u2713 (already existed)")
                continue
            api("PUT", f"/api/policies/{existing_id}", body)
            log(f"Creating policy: {name} ... \u2713 (updated)")
            continue
        api("POST", "/api/policies", body)
        log(f"Creating policy: {name} ... \u2713")

    dns = desired["dns"]
    target_group_ids = [
        require_id(group_name_to_id, "group", group_name)
        for group_name in dns["targetGroups"]
    ]
    pi_ip = "100.64.0.1"
    dns_body = {
        "name": f"{dns['domain']}-resolver",
        "description": f"Routes {dns['domain']} to the Pi's NetBird IP",
        "nameservers": [
            {
                "ip": pi_ip,
                "ns_type": "udp",
                "port": dns["localForwarderPort"],
            }
        ],
        "enabled": True,
        "groups": target_group_ids,
        "domains": [dns["domain"]],
        "search_domains_enabled": False,
    }
    existing_nameservers = api("GET", "/api/dns/nameservers") or []
    existing_by_domain = {
        entry["domains"][0]: entry
        for entry in existing_nameservers
        if entry.get("domains")
    }
    existing = existing_by_domain.get(dns["domain"])
    if existing is not None:
        existing_id = existing.get("id", "")
        if not existing_id:
            fail(f"DNS nameserver group for '{dns['domain']}' exists without an id")
        if normalize_dns_nameserver(existing) == normalize_dns_nameserver(dns_body):
            log(
                f"Configuring DNS: {dns['domain']} -> "
                f"{', '.join(dns['targetGroups'])} ... \u2713 (already existed)"
            )
        else:
            api("PUT", f"/api/dns/nameservers/{existing_id}", dns_body)
            log(
                f"Configuring DNS: {dns['domain']} -> "
                f"{', '.join(dns['targetGroups'])} ... \u2713 (updated)"
            )
    else:
        api("POST", "/api/dns/nameservers", dns_body)
        log(f"Configuring DNS: {dns['domain']} -> {', '.join(dns['targetGroups'])} ... \u2713")

    log("Done. Network topology applied.")
  '';

  configFile = pkgs.writeText "nixpi-netbird-config.json" (builtins.toJSON {
    groups = cfg.groups;
    setupKeys = cfg.setupKeys;
    postureChecks = cfg.postureChecks;
    policies = cfg.policies;
    dns = {
      inherit (cfg.dns) domain targetGroups localForwarderPort;
    };
  });
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf (cfg.apiTokenFile != null) {
    systemd.services.nixpi-netbird-provisioner = {
      description = "NetBird cloud state provisioner";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      restartIfChanged = true;
      unitConfig = {
        ConditionPathExists = cfg.apiTokenFile;
        StartLimitBurst = 3;
        StartLimitIntervalSec = 120;
      };
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = config.nixpi.primaryUser;
        Group = config.nixpi.primaryUser;
        Restart = "on-failure";
        RestartSec = "30s";
        ExecStart = "${pkgs.python3}/bin/python3 ${provisionerScript} ${cfg.apiTokenFile} ${cfg.apiEndpoint} ${configFile}";
      };
    };
  };
}
