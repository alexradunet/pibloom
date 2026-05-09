#!/usr/bin/env node
import { PlannerClient } from "./caldav.js";
import type { PlannerItem } from "./ical.js";

const REPEAT_MAP: Record<string, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
};

type ParsedArgs = { positional: string[]; flags: Map<string, string | true> };

function usage(): string {
  return `ownloom-planner — tiny local planner adapter over CalDAV/iCalendar

Usage:
  ownloom-planner init
  ownloom-planner add-task <title> [--due <date>] [--description <text>] [--priority <1-9>] [--category <name>]
                                    [--rrule <RRULE>] [--repeat daily|weekly|monthly|yearly|weekdays]
  ownloom-planner add-reminder <title> --at <date> [--description <text>] [--category <name>]
                                        [--rrule <RRULE>] [--repeat ...]
  ownloom-planner add-event <title> --start <date> [--end <date>] [--description <text>] [--category <name>]
                                     [--rrule <RRULE>] [--repeat ...]
  ownloom-planner edit <uid-prefix> [--title <text>] [--description <text>] [--priority <1-9|0>]
                                     [--category <name>] [--add-category <name>] [--remove-category <name>]
                                     [--clear-categories] [--json]
  ownloom-planner delete <uid-prefix>   (alias: rm)
  ownloom-planner snooze <reminder-uid-prefix> --to <date> [--json]
  ownloom-planner reschedule <uid-prefix> [--due <date>] [--start <date>] [--end <date>] [--json]
  ownloom-planner list [all|today|upcoming|overdue] [--json]
  ownloom-planner done <uid-prefix> [--json]

Environment:
  OWNLOOM_PLANNER_CALDAV_URL  default http://127.0.0.1:5232/
  OWNLOOM_PLANNER_USER        default alex
  OWNLOOM_PLANNER_COLLECTION  default planner`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) flags.set(key, true);
    else {
      flags.set(key, next);
      i += 1;
    }
  }
  return { positional, flags };
}

function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function categories(args: ParsedArgs): string[] {
  const value = flag(args, "category") ?? flag(args, "tag");
  return value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
}

function rruleArg(args: ParsedArgs): string | undefined {
  const raw = flag(args, "rrule");
  if (raw) return raw;
  const repeat = flag(args, "repeat");
  if (!repeat) return undefined;
  const mapped = REPEAT_MAP[repeat.toLowerCase()];
  if (!mapped) throw new Error(`Unknown --repeat value: ${repeat}. Valid: ${Object.keys(REPEAT_MAP).join(", ")}`);
  return mapped;
}

function priority(args: ParsedArgs): number | undefined {
  const value = flag(args, "priority");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9) throw new Error("--priority must be an integer from 1 to 9");
  return parsed;
}

function editPriority(args: ParsedArgs): number | undefined {
  const value = flag(args, "priority");
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) throw new Error("--priority must be an integer from 0 to 9");
  return parsed;
}

function printItem(item: PlannerItem): void {
  const when = item.alarmAt ?? item.due ?? item.start ?? "no-date";
  const marker = item.status === "done" ? "✓" : "•";
  console.log(`${marker} ${item.uid.slice(0, 12)} ${item.kind.padEnd(8)} ${when.padEnd(20)} ${item.title}`);
}

function printResult(item: PlannerItem, json: boolean): void {
  if (json) console.log(JSON.stringify(item, null, 2));
  else printItem(item);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0] ?? "help";
  const client = new PlannerClient();
  const json = args.flags.has("json");

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "init") {
    await client.init();
    console.log(`Planner collection ready: ${client.collectionUrl}`);
    return;
  }

  if (command === "add-task") {
    const title = args.positional.slice(1).join(" ").trim();
    if (!title) throw new Error("add-task requires a title");
    const item = await client.addTask({ title, due: flag(args, "due"), description: flag(args, "description"), priority: priority(args), categories: categories(args), rrule: rruleArg(args) });
    printResult(item, json);
    return;
  }

  if (command === "add-reminder") {
    const title = args.positional.slice(1).join(" ").trim();
    const at = flag(args, "at");
    if (!title) throw new Error("add-reminder requires a title");
    if (!at) throw new Error("add-reminder requires --at <date-or-iso>");
    const item = await client.addReminder({ title, at, description: flag(args, "description"), categories: categories(args), rrule: rruleArg(args) });
    printResult(item, json);
    return;
  }

  if (command === "add-event") {
    const title = args.positional.slice(1).join(" ").trim();
    const start = flag(args, "start");
    if (!title) throw new Error("add-event requires a title");
    if (!start) throw new Error("add-event requires --start <date-or-iso>");
    const item = await client.addEvent({ title, start, end: flag(args, "end"), description: flag(args, "description"), categories: categories(args), rrule: rruleArg(args) });
    printResult(item, json);
    return;
  }

  if (command === "list") {
    const view = (args.positional[1] ?? "all") as "all" | "today" | "upcoming" | "overdue";
    if (!["all", "today", "upcoming", "overdue"].includes(view)) throw new Error(`Unknown list view: ${view}`);
    const items = await client.list(view);
    if (json) console.log(JSON.stringify(items, null, 2));
    else if (items.length === 0) console.log("No planner items.");
    else items.forEach(printItem);
    return;
  }

  if (command === "done") {
    const uid = args.positional[1];
    if (!uid) throw new Error("done requires a UID prefix");
    const item = await client.done(uid);
    printResult(item, json);
    return;
  }

  if (command === "edit") {
    const uid = args.positional[1];
    if (!uid) throw new Error("edit requires a UID prefix");
    const editArgs = {
      title: flag(args, "title"),
      description: flag(args, "description"),
      priority: editPriority(args),
      categories: flag(args, "category") !== undefined ? flag(args, "category")!.split(",").map((c) => c.trim()).filter(Boolean) : undefined,
      addCategories: flag(args, "add-category") !== undefined ? flag(args, "add-category")!.split(",").map((c) => c.trim()).filter(Boolean) : undefined,
      removeCategories: flag(args, "remove-category") !== undefined ? flag(args, "remove-category")!.split(",").map((c) => c.trim()).filter(Boolean) : undefined,
      clearCategories: args.flags.has("clear-categories") ? true : undefined,
    };
    if (Object.values(editArgs).every((v) => v === undefined)) throw new Error("edit requires at least one field flag (--title, --description, --priority, --category, etc.)");
    const item = await client.edit(uid, editArgs);
    printResult(item, json);
    return;
  }

  if (command === "delete" || command === "rm") {
    const uid = args.positional[1];
    if (!uid) throw new Error(`${command} requires a UID prefix`);
    await client.delete(uid);
    console.log(`Deleted: ${uid}`);
    return;
  }

  if (command === "snooze") {
    const uid = args.positional[1];
    const to = flag(args, "to");
    if (!uid) throw new Error("snooze requires a reminder UID prefix");
    if (!to) throw new Error("snooze requires --to <date-or-iso>");
    const item = await client.snooze(uid, to);
    printResult(item, json);
    return;
  }

  if (command === "reschedule") {
    const uid = args.positional[1];
    if (!uid) throw new Error("reschedule requires a UID prefix");
    const rescheduleArgs = { due: flag(args, "due"), start: flag(args, "start"), end: flag(args, "end") };
    if (!rescheduleArgs.due && !rescheduleArgs.start && !rescheduleArgs.end) throw new Error("reschedule requires --due, --start, or --end");
    const item = await client.reschedule(uid, rescheduleArgs);
    printResult(item, json);
    return;
  }


  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
