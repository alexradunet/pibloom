import * as http from "node:http";
import { URL } from "node:url";
import { PlannerClient } from "./caldav.js";
import type { PlannerItem } from "./ical.js";

const DEFAULT_PORT = Number(process.env.OWNLOOM_PLANNER_PORT ?? "8082");
const DEFAULT_LISTEN = process.env.OWNLOOM_PLANNER_LISTEN ?? "127.0.0.1";
const JSON_LIMIT_BYTES = 64 * 1024;

const REPEAT_MAP: Record<string, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
};

type PlannerView = "all" | "today" | "upcoming" | "overdue";
type PlannerApiClient = Pick<PlannerClient, "addTask" | "addReminder" | "addEvent" | "delete" | "done" | "edit" | "list" | "reschedule" | "snooze">;
type JsonObject = Record<string, unknown>;

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function htmlPage(itemsHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ownloom Planner</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#111;color:#eee;margin:0}
h1{margin:0;padding:12px 16px;background:#1a1a2e;border-bottom:1px solid #333;font-size:1.1rem}.sub{color:#aaa;font-size:.8rem;padding:8px 16px}
table{width:100%;border-collapse:collapse}td,th{padding:10px 14px;text-align:left}
th{background:#222;color:#888;font-weight:500;font-size:.7rem;text-transform:uppercase}
tr{border-bottom:1px solid #222}
tr.done td{color:#555;text-decoration:line-through}
.date{color:#999;font-size:.8rem;width:120px}
.kind{text-transform:uppercase;font-size:.6rem;letter-spacing:.05em;font-weight:600;color:#0bf;width:60px}
form{margin:0}xmp{display:none}
a{color:#0bf;text-decoration:none}
a:hover{text-decoration:underline}
</style>
</head><body>
  <h1>ownloom Planner</h1>
  <div class="sub">${new Date().toLocaleString("en-RO", { timeZone: "Europe/Bucharest" })}</div>
  <table><thead><tr><th class="kind">Kind</th><th class="date">When</th><th>Title</th><th>Categories</th></tr></thead><tbody>
  ${itemsHtml}
  </tbody></table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rowHtml(item: PlannerItem): string {
  const cls = item.status === "done" ? "done" : "";
  const when = item.alarmAt ?? item.due ?? item.start ?? "";
  const cats = item.categories.filter((c) => c !== "reminder").join(", ");
  return `<tr class="${cls}"><td class="kind">${escapeHtml(item.kind)}</td><td class="date">${escapeHtml(when)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(cats)}</td></tr>`;
}

export function createRequestHandler(client: PlannerApiClient = new PlannerClient()): http.RequestListener {
  return async (request, response) => {
    try {
      if (!isAllowedRequest(request)) {
        writeJson(response, 421, { error: "Misdirected request" });
        return;
      }
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi(client, request, response, requestUrl);
        return;
      }

      const items = await client.list("all");
      const html = htmlPage(items.map(rowHtml).join(""));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...noStoreHeaders });
      response.end(html);
    } catch (error: any) {
      writeError(response, error);
    }
  };
}

export function startServer(options: { port?: number; listen?: string; client?: PlannerApiClient } = {}): http.Server {
  const listen = options.listen ?? DEFAULT_LISTEN;
  const port = options.port ?? DEFAULT_PORT;
  const server = http.createServer(createRequestHandler(options.client));
  server.listen(port, listen, () => {
    console.error(`ownloom planner web view/API at http://${listen}:${port}/`);
  });
  return server;
}

async function handleApi(client: PlannerApiClient, request: http.IncomingMessage, response: http.ServerResponse, requestUrl: URL): Promise<void> {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const resource = parts[1];

  if (resource === "items" && parts.length === 2) {
    if (request.method === "GET") {
      const view = parseView(requestUrl.searchParams.get("view") ?? "all");
      writeJson(response, 200, await client.list(view));
      return;
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      writeJson(response, 201, await createItem(client, body));
      return;
    }
    writeMethodNotAllowed(response, "GET, POST");
    return;
  }

  if ((resource === "tasks" || resource === "reminders" || resource === "events") && parts.length === 2) {
    if (request.method !== "POST") {
      writeMethodNotAllowed(response, "POST");
      return;
    }
    const body = await readJsonObject(request);
    const kind = resource === "tasks" ? "task" : resource === "reminders" ? "reminder" : "event";
    writeJson(response, 201, await createItem(client, { ...body, kind }));
    return;
  }

  if (resource === "items" && parts.length >= 3) {
    const uid = uidPrefixFromPath(parts[2]);
    const action = parts[3];

    if (parts.length === 3 && request.method === "PATCH") {
      const body = await readJsonObject(request);
      writeJson(response, 200, await client.edit(uid, editArgs(body)));
      return;
    }

    if (parts.length === 3 && request.method === "DELETE") {
      await client.delete(uid);
      writeJson(response, 200, { ok: true, uid });
      return;
    }

    if (parts.length === 4 && request.method === "POST" && action === "done") {
      writeJson(response, 200, await client.done(uid));
      return;
    }

    if (parts.length === 4 && request.method === "POST" && action === "snooze") {
      const body = await readJsonObject(request);
      writeJson(response, 200, await client.snooze(uid, requiredString(body, "to")));
      return;
    }

    if (parts.length === 4 && request.method === "POST" && action === "reschedule") {
      const body = await readJsonObject(request);
      writeJson(response, 200, await client.reschedule(uid, rescheduleArgs(body)));
      return;
    }
  }

  // Backwards-compatible endpoint used by the first tiny web view.
  if (requestUrl.pathname === "/api/done" && request.method === "POST") {
    const uid = requestUrl.searchParams.get("uid");
    if (!uid) throw badRequest("Missing uid");
    writeJson(response, 200, await client.done(normalizeUidPrefix(uid)));
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

function parseView(value: string): PlannerView {
  if (value === "all" || value === "today" || value === "upcoming" || value === "overdue") return value;
  throw badRequest("Invalid view");
}

async function createItem(client: PlannerApiClient, body: JsonObject): Promise<PlannerItem> {
  const kind = requiredString(body, "kind");
  if (kind === "task") {
    return client.addTask({
      title: requiredString(body, "title"),
      description: optionalString(body, "description"),
      due: optionalString(body, "due"),
      priority: optionalPriority(body, false),
      categories: optionalCategories(body, "categories"),
      rrule: rruleFromBody(body),
    });
  }
  if (kind === "reminder") {
    return client.addReminder({
      title: requiredString(body, "title"),
      description: optionalString(body, "description"),
      at: requiredString(body, "at"),
      categories: optionalCategories(body, "categories"),
      rrule: rruleFromBody(body),
    });
  }
  if (kind === "event") {
    return client.addEvent({
      title: requiredString(body, "title"),
      description: optionalString(body, "description"),
      start: requiredString(body, "start"),
      end: optionalString(body, "end"),
      categories: optionalCategories(body, "categories"),
      rrule: rruleFromBody(body),
    });
  }
  throw badRequest("kind must be task, reminder, or event");
}

function editArgs(body: JsonObject) {
  const args = {
    title: optionalString(body, "title"),
    description: optionalText(body, "description"),
    priority: optionalPriority(body, true),
    categories: optionalCategories(body, "categories"),
    addCategories: optionalCategories(body, "addCategories"),
    removeCategories: optionalCategories(body, "removeCategories"),
    clearCategories: optionalBoolean(body, "clearCategories"),
  };
  if (Object.values(args).every((value) => value === undefined)) throw badRequest("edit requires at least one field");
  return args;
}

function rescheduleArgs(body: JsonObject): { due?: string; start?: string; end?: string } {
  const args = {
    due: optionalString(body, "due"),
    start: optionalString(body, "start"),
    end: optionalString(body, "end"),
  };
  if (!args.due && !args.start && !args.end) throw badRequest("reschedule requires due, start, or end");
  return args;
}

async function readJsonObject(request: http.IncomingMessage): Promise<JsonObject> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > JSON_LIMIT_BYTES) throw httpError(413, "JSON body too large");
  }
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("Invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw badRequest("JSON body must be an object");
  return parsed as JsonObject;
}

function requiredString(body: JsonObject, name: string): string {
  const value = optionalString(body, name);
  if (!value) throw badRequest(`${name} is required`);
  return value;
}

function optionalString(body: JsonObject, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw badRequest(`${name} must be a string`);
  return value.trim();
}

function optionalText(body: JsonObject, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`${name} must be a string`);
  return value;
}

function optionalBoolean(body: JsonObject, name: string): boolean | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${name} must be a boolean`);
  return value;
}

function optionalPriority(body: JsonObject, allowZero: boolean): number | undefined {
  const value = body.priority;
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < min || parsed > 9) {
    throw badRequest(`priority must be an integer from ${min} to 9`);
  }
  return parsed;
}

function optionalCategories(body: JsonObject, name: string): string[] | undefined {
  const value = body[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return splitCategories(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value.map((entry) => entry.trim()).filter(Boolean);
  throw badRequest(`${name} must be a string or string array`);
}

function splitCategories(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function rruleFromBody(body: JsonObject): string | undefined {
  const raw = optionalString(body, "rrule");
  if (raw) return raw;
  const repeat = optionalString(body, "repeat")?.toLowerCase();
  if (!repeat) return undefined;
  const mapped = REPEAT_MAP[repeat];
  if (!mapped) throw badRequest(`Unknown repeat value: ${repeat}`);
  return mapped;
}

function uidPrefixFromPath(value: string): string {
  return normalizeUidPrefix(decodeURIComponent(value));
}

function normalizeUidPrefix(value: string): string {
  return value.replace(/@\d{4}-\d{2}-\d{2}$/, "");
}

function isAllowedRequest(request: http.IncomingMessage): boolean {
  return isAllowedHostHeader(request.headers.host) && isAllowedOriginHeader(request.headers.origin);
}

function isAllowedHostHeader(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.every((entry) => isAllowedHostHeader(entry));
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return isLoopbackHostname(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

function isAllowedOriginHeader(value: string | string[] | undefined): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.every((entry) => isAllowedOriginHeader(entry));
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(value: string): boolean {
  const hostname = String(value ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...noStoreHeaders,
  });
  response.end(JSON.stringify(body));
}

function writeMethodNotAllowed(response: http.ServerResponse, allow: string): void {
  response.writeHead(405, {
    Allow: allow,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...noStoreHeaders,
  });
  response.end(JSON.stringify({ error: "Method not allowed" }));
}

function writeError(response: http.ServerResponse, error: any): void {
  if (response.headersSent) {
    response.destroy(error);
    return;
  }
  const status = typeof error?.statusCode === "number" ? error.statusCode : statusForError(error);
  writeJson(response, status, { error: error?.message ?? String(error) });
}

function statusForError(error: any): number {
  const message = String(error?.message ?? error);
  if (/ambiguous/i.test(message)) return 409;
  if (/No .* found/i.test(message)) return 404;
  if (/Invalid|Missing|required|must be|Unknown repeat|Unknown list view/i.test(message)) return 400;
  return 500;
}

function badRequest(message: string): Error & { statusCode: number } {
  return httpError(400, message);
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

if (import.meta.url.endsWith(process.argv[1] ?? "")) startServer();
