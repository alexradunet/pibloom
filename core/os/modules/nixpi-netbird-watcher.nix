{ pkgs, config, lib, ... }:

let
  cfg = config.nixpi.netbird;
  hostname = config.networking.hostName;
  stateDir = "${config.nixpi.stateDir}/netbird-watcher";
  matrixBaseUrl = "http://127.0.0.1:${toString config.nixpi.matrix.port}";
  networkActivityRoomAlias = "#network-activity:${hostname}";

  watcherScript = pkgs.writeText "nixpi-netbird-watcher.py" ''
    import json
    import pathlib
    import sys
    import time
    import urllib.error
    import urllib.parse
    import urllib.request


    NETBIRD_TOKEN_FILE = sys.argv[1]
    NETBIRD_BASE = sys.argv[2]
    MATRIX_BASE = sys.argv[3]
    MATRIX_TOKEN_FILE = sys.argv[4]
    ROOM_ALIAS = sys.argv[5]
    STATE_DIR = pathlib.Path(sys.argv[6])

    MAX_BUFFER = 50
    MAX_FIRST_RUN_EVENTS = 10


    def log(message):
        print(f"[watcher] {message}", flush=True)


    def read_file(path):
        try:
            return pathlib.Path(path).read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return None


    netbird_token = read_file(NETBIRD_TOKEN_FILE)
    matrix_token = read_file(MATRIX_TOKEN_FILE)
    if not netbird_token or not matrix_token:
        log("Missing token files - exiting")
        sys.exit(0)

    NETBIRD_HEADERS = {
        "Authorization": f"Token {netbird_token}",
        "Accept": "application/json",
    }
    MATRIX_HEADERS = {
        "Authorization": f"Bearer {matrix_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


    def netbird_get(path):
        url = NETBIRD_BASE.rstrip("/") + path
        request = urllib.request.Request(url, headers=NETBIRD_HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = response.read()
        except Exception as error:
            log(f"NetBird API error: {error}")
            return None
        return json.loads(payload) if payload else None


    def matrix_get(path):
        url = MATRIX_BASE.rstrip("/") + path
        request = urllib.request.Request(url, headers=MATRIX_HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = response.read()
        except Exception as error:
            log(f"Matrix API error: {error}")
            return None
        return json.loads(payload) if payload else None


    def matrix_put(path, body):
        url = MATRIX_BASE.rstrip("/") + path
        data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=MATRIX_HEADERS, method="PUT")
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = response.read()
        except Exception as error:
            log(f"Matrix API error: {error}")
            return None
        return json.loads(payload) if payload else None


    def resolve_room_id(alias):
        encoded_alias = urllib.parse.quote(alias, safe="")
        result = matrix_get(f"/_matrix/client/v3/directory/room/{encoded_alias}")
        if not result:
            return None
        return result.get("room_id")


    def format_event(event):
        activity = event.get("activity", "")
        meta = event.get("meta", {}) or {}
        if activity == "peer.add":
            return f"New peer joined: {meta.get('peer', '?')} ({meta.get('ip', '?')})"
        if activity == "peer.delete":
            return f"Peer removed: {meta.get('peer', '?')}"
        if activity == "user.login":
            return f"User logged in: {meta.get('email', '?')}"
        if activity == "policy.update":
            return f"Policy updated: {meta.get('name', '?')} by {meta.get('user', '?')}"
        if activity == "setup_key.used":
            return f"Setup key used: {meta.get('name', '?')} - new peer enrolled"
        return None


    def event_is_new(event, last_seen_id):
        event_id = str(event.get("id", ""))
        if last_seen_id is None:
            return True
        try:
            return int(event_id) > int(last_seen_id)
        except ValueError:
            return event_id > last_seen_id


    last_id_file = STATE_DIR / "last-event-id"
    pending_file = STATE_DIR / "pending-events"
    last_seen_id = read_file(last_id_file)
    is_first_run = last_seen_id is None

    events = netbird_get("/api/events?limit=100")
    if events is None:
        sys.exit(0)

    new_events = [event for event in events if event_is_new(event, last_seen_id)]
    new_events = list(reversed(new_events))
    if is_first_run:
        new_events = new_events[-MAX_FIRST_RUN_EVENTS:]

    pending_events = []
    if pending_file.exists():
        try:
            pending_events = json.loads(pending_file.read_text(encoding="utf-8"))
        except Exception:
            pending_events = []

    to_deliver = pending_events + new_events
    if not to_deliver:
        sys.exit(0)

    room_id = resolve_room_id(ROOM_ALIAS)
    if not room_id:
        buffered = to_deliver[-MAX_BUFFER:]
        pending_file.write_text(json.dumps(buffered), encoding="utf-8")
        log(f"Matrix unavailable - buffered {len(buffered)} events")
        sys.exit(0)

    remaining = []
    txn_base = int(time.time() * 1000)
    for index, event in enumerate(to_deliver):
        message = format_event(event)
        if message is None:
            continue
        txn_id = f"nb-{txn_base}-{index}"
        result = matrix_put(
            f"/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{txn_id}",
            {"msgtype": "m.text", "body": message},
        )
        if result is None:
            remaining.append(event)

    if remaining:
        buffered = remaining[-MAX_BUFFER:]
        pending_file.write_text(json.dumps(buffered), encoding="utf-8")
        log(f"{len(buffered)} events pending delivery")
    elif pending_file.exists():
        pending_file.unlink()

    if new_events:
        newest_id = str(new_events[-1].get("id", last_seen_id or ""))
        if newest_id:
            last_id_file.write_text(newest_id, encoding="utf-8")
  '';
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf (cfg.apiTokenFile != null) {
    systemd.services.nixpi-netbird-watcher = {
      description = "NetBird event to Matrix notifier";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      unitConfig.ConditionPathExists = cfg.apiTokenFile;
      serviceConfig = {
        Type = "oneshot";
        StateDirectory = "nixpi/netbird-watcher";
        User = config.nixpi.primaryUser;
        Group = config.nixpi.primaryUser;
        ExecStart = "${pkgs.python3}/bin/python3 ${watcherScript} ${cfg.apiTokenFile} ${cfg.apiEndpoint} ${matrixBaseUrl} ${stateDir}/matrix-token ${networkActivityRoomAlias} ${stateDir}";
      };
    };

    systemd.timers.nixpi-netbird-watcher = {
      description = "NetBird watcher timer";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = "2min";
        OnUnitActiveSec = "60s";
        Unit = "nixpi-netbird-watcher.service";
      };
    };
  };
}
