{pkgs, ...}:
pkgs.testers.runNixOSTest {
  name = "planner-radicale";

  nodes.planner = {...}: {
    imports = [
      ../../features/nixos/paths/module.nix
      ../../features/nixos/service-planner/module.nix
    ];

    networking.hostName = "planner-radicale-test";
    system.stateVersion = "26.05";

    # ownloom.human.name defaults to "human" from paths.
    services.ownloom-planner.enable = true;
  };

  testScript = ''
    import json

    env = (
        "OWNLOOM_PLANNER_CALDAV_URL=http://127.0.0.1:5232/"
        " OWNLOOM_PLANNER_USER=human"
        " OWNLOOM_PLANNER_COLLECTION=planner"
    )

    planner.start()
    planner.wait_for_unit("radicale.service")
    planner.wait_for_open_port(5232)

    # Initialise the CalDAV collection.
    planner.succeed(f"{env} ownloom-planner init")

    # add-task and verify round-trip.
    task_json = planner.succeed(
        f"{env} ownloom-planner add-task 'Buy milk' --due 2026-06-01 --json"
    )
    task = json.loads(task_json)
    assert task["title"] == "Buy milk", f"Unexpected title: {task}"
    assert task["kind"] == "task", f"Unexpected kind: {task}"
    task_uid = task["uid"]

    # add-reminder.
    planner.succeed(
        f"{env} ownloom-planner add-reminder 'Check in' --at 2026-06-15T09:00:00"
    )

    # list returns both items.
    list_out = planner.succeed(f"{env} ownloom-planner list all --json")
    items = json.loads(list_out)
    titles = [i["title"] for i in items]
    assert "Buy milk" in titles, f"'Buy milk' not in list: {titles}"
    assert "Check in" in titles, f"'Check in' not in list: {titles}"

    # done: mark the task complete.
    done_json = planner.succeed(
        f"{env} ownloom-planner done {task_uid} --json"
    )
    done = json.loads(done_json)
    assert done["status"] == "done", f"Task not marked done: {done}"

    # ICS files must exist on disk.
    planner.succeed(
        "find /var/lib/ownloom-planner/radicale/collections -name '*.ics' | grep ."
    )
  '';
}
