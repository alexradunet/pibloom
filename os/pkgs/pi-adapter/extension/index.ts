import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StringEnum } from "@mariozechner/pi-ai";
import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { formatFleetHostStatus } from "./shared.ts";
import { readUpdateStatus, writeUpdateStatus } from "./state.ts";
import registerWikiExtension from "./wiki/index.ts";

const execFileAsync = promisify(execFile);
const PLANNER_ACTIONS = ["init", "add_task", "add_reminder", "add_event", "snooze", "reschedule", "list", "done", "edit", "delete"] as const;
const PLANNER_VIEWS = ["all", "today", "upcoming", "overdue"] as const;

async function runText(command: string, args: string[], timeout = 10_000): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { timeout, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}

async function buildownloomContext(): Promise<string> {
  try {
    const text = await runText("ownloom-context", ["--format", "markdown"], 15_000);
    return text ? `\n\n${text}` : "";
  } catch (error: any) {
    const message = error?.stderr?.toString()?.trim() || error?.message || String(error);
    return `\n\n[OWNLOOM CONTEXT ERROR]\nFailed to run ownloom-context: ${message}`;
  }
}

function registerPlannerTool(pi: ExtensionAPI) {
  for (const toolName of ["ownloom_planner", "nixpi_planner"] as const) pi.registerTool({
    name: toolName,
    label: toolName === "ownloom_planner" ? "ownloom Planner" : "nixpi planner (compat)",
    description: "Manage canonical live tasks, reminders, and calendar events through the local CalDAV/iCalendar planner backend.",
    promptSnippet: toolName === "ownloom_planner"
      ? "Use ownloom_planner for live task, reminder, and calendar operations instead of creating wiki Markdown task/reminder pages."
      : "Compatibility alias: prefer ownloom_planner for new prompts; use this only for old nixpi prompts.",
    promptGuidelines: [
      "Use for live operational tasks/reminders/events.",
      "Do not use wiki task/reminder pages as the live source of truth unless the user explicitly asks for an archive/context note.",
      "Use action=list with view=today/upcoming/overdue before summarizing current planner state.",
    ],
    parameters: Type.Object({
      action: StringEnum(PLANNER_ACTIONS, { description: "init, add_task, add_reminder, add_event, list, or done." }),
      title: Type.Optional(Type.String({ description: "Title for add_task/add_reminder/add_event." })),
      description: Type.Optional(Type.String({ description: "Optional item description." })),
      due: Type.Optional(Type.String({ description: "Due date/time for add_task." })),
      at: Type.Optional(Type.String({ description: "Reminder date/time for add_reminder." })),
      start: Type.Optional(Type.String({ description: "Event start date/time for add_event." })),
      end: Type.Optional(Type.String({ description: "Optional event end date/time for add_event." })),
      priority: Type.Optional(Type.Number({ description: "Optional task priority 1-9." })),
      categories: Type.Optional(Type.Array(Type.String({ description: "Optional categories/tags." }))),
      uid_prefix: Type.Optional(Type.String({ description: "UID prefix for done/reschedule/edit/delete; reminder UID prefix for snooze." })),
      reschedule_to: Type.Optional(Type.String({ description: "New date/time for snooze." })),
      view: Type.Optional(StringEnum(PLANNER_VIEWS, { description: "List view. Defaults to upcoming." })),
      rrule: Type.Optional(Type.String({ description: "RFC 5545 RRULE string." })),
      repeat: Type.Optional(Type.String({ description: "Shorthand repeat: daily | weekly | monthly | yearly | weekdays" })),
      add_categories: Type.Optional(Type.Array(Type.String({ description: "Categories to add to an existing item." }))),
      remove_categories: Type.Optional(Type.Array(Type.String({ description: "Categories to remove from an existing item." }))),
      clear_categories: Type.Optional(Type.Boolean({ description: "Remove all categories from an existing item." })),
    }),
    async execute(_toolCallId, params) {
      const args = plannerArgs(params);
      try {
        const { stdout } = await execFileAsync("ownloom-planner", args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
        const text = stdout.trim() || "OK";
        let details: unknown = { ok: true, action: params.action };
        try {
          details = { ok: true, action: params.action, result: JSON.parse(text) };
        } catch {
          // Keep text-only details when the CLI emits plain text.
        }
        return { content: [{ type: "text", text }], details };
      } catch (error: any) {
        const message = error?.stderr?.toString()?.trim() || error?.message || String(error);
        return { content: [{ type: "text", text: message }], isError: true, details: { ok: false, action: params.action } };
      }
    },
  });
}

function plannerArgs(params: any): string[] {
  const action = params.action;
  if (action === "init") return ["init"];
  if (action === "list") return ["list", params.view ?? "upcoming", "--json"];
  if (action === "done" || action === "snooze") {
    if (!params.uid_prefix) throw new Error(`planner action=${action} requires uid_prefix.`);
    if (action === "snooze") {
      if (!params.reschedule_to) throw new Error("planner action=snooze requires reschedule_to.");
      return ["snooze", params.uid_prefix, "--to", params.reschedule_to, "--json"];
    }
    return ["done", params.uid_prefix, "--json"];
  }
  if (action === "reschedule") {
    if (!params.uid_prefix) throw new Error("planner action=reschedule requires uid_prefix.");
    const args: string[] = ["reschedule", params.uid_prefix];
    if (params.due) args.push("--due", params.due);
    if (params.start) args.push("--start", params.start);
    if (params.end) args.push("--end", params.end);
    args.push("--json");
    return args;
  }
  if (action === "edit") {
    if (!params.uid_prefix) throw new Error("planner action=edit requires uid_prefix.");
    const args: string[] = ["edit", params.uid_prefix];
    if (params.title) args.push("--title", params.title);
    if (params.description) args.push("--description", params.description);
    if (params.priority !== undefined) args.push("--priority", String(params.priority));
    if (params.categories?.length) args.push("--category", params.categories.join(","));
    if (params.add_categories?.length) args.push("--add-category", params.add_categories.join(","));
    if (params.remove_categories?.length) args.push("--remove-category", params.remove_categories.join(","));
    if (params.clear_categories) args.push("--clear-categories");
    args.push("--json");
    return args;
  }
  if (action === "delete") {
    if (!params.uid_prefix) throw new Error("planner action=delete requires uid_prefix.");
    return ["delete", params.uid_prefix];
  }

  if (!params.title) throw new Error(`planner action=${action} requires title.`);
  const args: string[] = [action.replace("_", "-"), params.title];
  if (params.description) args.push("--description", params.description);
  if (params.categories?.length) args.push("--category", params.categories.join(","));
  if (params.rrule) args.push("--rrule", params.rrule);
  else if (params.repeat) args.push("--repeat", params.repeat);
  if (action === "add_task") {
    if (params.due) args.push("--due", params.due);
    if (params.priority !== undefined) args.push("--priority", String(params.priority));
  } else if (action === "add_reminder") {
    if (!params.at) throw new Error("planner action=add_reminder requires at.");
    args.push("--at", params.at);
  } else if (action === "add_event") {
    if (!params.start) throw new Error("planner action=add_event requires start.");
    args.push("--start", params.start);
    if (params.end) args.push("--end", params.end);
  }
  args.push("--json");
  return args;
}

export default function ownloomExtension(pi: ExtensionAPI) {
  registerWikiExtension(pi);
  registerPlannerTool(pi);

  pi.registerCommand("ownloom", {
    description: "ownloom context check: /ownloom context",
    handler: async (_args, ctx) => {
      try {
        const text = await runText("ownloom-context", ["--format", "markdown"], 15_000);
        if (ctx.hasUI) ctx.ui.notify(text || "ownloom-context produced no output.", "info");
      } catch (error: any) {
        const message = error?.stderr?.toString()?.trim() || error?.message || String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("fleet", formatFleetHostStatus());
      ctx.ui.setStatus("ownloom", "ownloom runtime: active");
    }
  });

  pi.on("before_agent_start", async (event) => {
    let note = await buildownloomContext();

    const updateStatus = readUpdateStatus();
    if (updateStatus?.available && !updateStatus.notified) {
      await writeUpdateStatus({ ...updateStatus, notified: true });
      note += `\n\n[UPDATE AVAILABLE] The ownloom repo is ${updateStatus.behindBy} commit(s) behind origin/${updateStatus.branch ?? "main"}. Inform the user and offer to pull and apply.`;
    }

    return { systemPrompt: event.systemPrompt + note };
  });
}
