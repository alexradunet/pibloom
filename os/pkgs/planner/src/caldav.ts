import { createUid, eventIcs, markTodoDone, parsePlannerItem, todayStamp, todoIcs, updateEventDates, updateEventFields, updateTodoFields, updateTodoDates, type EditEventArgs, type EditTodoArgs, type PlannerItem } from "./ical.js";
import { createRequire } from "node:module";

// rrule ships CJS-only; load via createRequire from ESM context.
const _req = createRequire(import.meta.url);
type RruleInstance = { between(after: Date, before: Date, inc?: boolean): Date[]; after(dt: Date, inc?: boolean): Date | null };
const { rrulestr } = _req("rrule") as { rrulestr: (str: string) => RruleInstance };

export type PlannerClientOptions = {
  baseUrl?: string;
  user?: string;
  collection?: string;
};

export class PlannerClient {
  readonly baseUrl: string;
  readonly user: string;
  readonly collection: string;

  constructor(options: PlannerClientOptions = {}) {
    this.baseUrl = ensureSlash(options.baseUrl ?? process.env.OWNLOOM_PLANNER_CALDAV_URL ?? "http://127.0.0.1:5232/");
    this.user = options.user ?? process.env.OWNLOOM_PLANNER_USER ?? "alex";
    this.collection = options.collection ?? process.env.OWNLOOM_PLANNER_COLLECTION ?? "planner";
  }

  get userUrl(): string {
    return new URL(`${encodeURIComponent(this.user)}/`, this.baseUrl).toString();
  }

  get collectionUrl(): string {
    return new URL(`${encodeURIComponent(this.user)}/${encodeURIComponent(this.collection)}/`, this.baseUrl).toString();
  }

  async init(): Promise<void> {
    await request(this.userUrl, { method: "MKCOL" }, [201, 405, 409]);
    await request(this.collectionUrl, {
      method: "MKCALENDAR",
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop>
    <D:displayname>ownloom Planner</D:displayname>
    <C:supported-calendar-component-set><C:comp name="VTODO"/><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>`,
    }, [201, 405, 409]);
  }

  async addTask(args: { title: string; description?: string; due?: string; priority?: number; categories?: string[]; rrule?: string }): Promise<PlannerItem> {
    await this.init();
    const uid = createUid();
    const ics = todoIcs({ ...args, uid });
    await this.put(uid, ics);
    return parsePlannerItem(ics, this.hrefForUid(uid))!;
  }

  async addReminder(args: { title: string; description?: string; at: string; categories?: string[]; rrule?: string }): Promise<PlannerItem> {
    await this.init();
    const uid = createUid();
    const categories = ["reminder", ...(args.categories ?? [])];
    const ics = todoIcs({ uid, title: args.title, description: args.description, due: args.at, reminderAt: args.at, categories, rrule: args.rrule });
    await this.put(uid, ics);
    return parsePlannerItem(ics, this.hrefForUid(uid))!;
  }

  async addEvent(args: { title: string; description?: string; start: string; end?: string; categories?: string[]; rrule?: string }): Promise<PlannerItem> {
    await this.init();
    const uid = createUid();
    const ics = eventIcs({ ...args, uid });
    await this.put(uid, ics);
    return parsePlannerItem(ics, this.hrefForUid(uid))!;
  }

  async list(view: "all" | "today" | "upcoming" | "overdue" = "all"): Promise<PlannerItem[]> {
    await this.init();
    const xml = await requestText(this.collectionUrl, {
      method: "REPORT",
      headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"/></C:filter>
</C:calendar-query>`,
    }, [207]);
    const items = parseMultistatus(xml).map(({ href, ics }) => parsePlannerItem(ics, href)).filter((item): item is PlannerItem => Boolean(item));
    if (view === "all") return items.sort(compareItems);

    const todayStart = localDayStart(new Date());
    const windowStart = view === "overdue"
      ? new Date(todayStart.getTime() - 90 * 24 * 60 * 60 * 1000)
      : todayStart;
    const windowEnd = view === "today"
      ? new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
      : view === "upcoming"
        ? new Date(todayStart.getTime() + 30 * 24 * 60 * 60 * 1000)
        : todayStart; // overdue: up to (not including) today

    const expanded = items.flatMap((item) => {
      if (item.rrule && item.status === "open") return expandRrule(item, windowStart, windowEnd);
      return [item];
    });
    return filterView(expanded, view).sort(compareItems);
  }

  async done(uidPrefix: string): Promise<PlannerItem> {
    const matches = (await this.list("all")).filter((item) => item.kind !== "event" && item.uid.startsWith(uidPrefix));
    if (matches.length === 0) throw new Error(`No task/reminder found for UID prefix: ${uidPrefix}`);
    if (matches.length > 1) throw new Error(`UID prefix is ambiguous: ${uidPrefix}`);
    const item = matches[0];
    if (!item.href || !item.raw) throw new Error(`Task has no href/raw calendar data: ${item.uid}`);
    // Recurring item: roll DUE forward instead of marking complete
    if (item.rrule) {
      const currentDue = item.due ?? item.alarmAt;
      const afterDate = currentDue ? new Date(currentDue) : new Date();
      const next = nextDueAfter(item, afterDate);
      if (next) {
        const nextValue = occurrenceValue(next, isDateOnlyString(currentDue));
        const updated = updateTodoDates(item.raw, { due: nextValue, reminderAt: item.kind === "reminder" ? nextValue : undefined });
        await this.putRaw(item.href, updated);
        return parsePlannerItem(updated, item.href)!;
      }
      // RRULE exhausted — fall through and mark done normally
    }
    const updated = markTodoDone(item.raw);
    await this.putRaw(item.href, updated);
    return parsePlannerItem(updated, item.href)!;
  }

  async edit(uidPrefix: string, args: EditTodoArgs & EditEventArgs): Promise<PlannerItem> {
    const matches = (await this.list("all")).filter((item) => item.uid.startsWith(uidPrefix));
    if (matches.length === 0) throw new Error(`No item found for UID prefix: ${uidPrefix}`);
    if (matches.length > 1) throw new Error(`UID prefix is ambiguous: ${uidPrefix} (${matches.length} matches)`);
    const item = matches[0];
    if (!item.href || !item.raw) throw new Error(`Item has no href/raw data: ${item.uid}`);
    const updated = item.kind === "event" ? updateEventFields(item.raw, args) : updateTodoFields(item.raw, args);
    await this.putRaw(item.href, updated);
    return parsePlannerItem(updated, item.href)!;
  }

  async delete(uidPrefix: string): Promise<void> {
    const matches = (await this.list("all")).filter((item) => item.uid.startsWith(uidPrefix));
    if (matches.length === 0) throw new Error(`No item found for UID prefix: ${uidPrefix}`);
    if (matches.length > 1) throw new Error(`UID prefix is ambiguous: ${uidPrefix} (${matches.length} matches)`);
    const item = matches[0];
    if (!item.href) throw new Error(`Item has no href: ${item.uid}`);
    await request(new URL(item.href, this.baseUrl).toString(), { method: "DELETE" }, [200, 204, 404]);
  }

  async snooze(uidPrefix: string, due: string): Promise<PlannerItem> {
    const matches = (await this.list("all")).filter((item) => item.kind === "reminder" && item.uid.startsWith(uidPrefix));
    if (matches.length === 0) throw new Error(`No reminder found for UID prefix: ${uidPrefix}`);
    if (matches.length > 1) throw new Error(`UID prefix is ambiguous: ${uidPrefix}`);
    const item = matches[0];
    if (!item.href || !item.raw) throw new Error(`Reminder has no href/raw calendar data: ${item.uid}`);
    const updated = updateTodoDates(item.raw, { due, reminderAt: due });
    await this.putRaw(item.href, updated);
    return parsePlannerItem(updated, item.href)!;
  }

  async reschedule(uidPrefix: string, args: { due?: string; start?: string; end?: string }): Promise<PlannerItem> {
    const matches = (await this.list("all")).filter((item) => item.uid.startsWith(uidPrefix));
    if (matches.length === 0) throw new Error(`No planner item found for UID prefix: ${uidPrefix}`);
    if (matches.length > 1) throw new Error(`UID prefix is ambiguous: ${uidPrefix}`);
    const item = matches[0];
    if (!item.href || !item.raw) throw new Error(`Item has no href/raw calendar data: ${item.uid}`);
    if (item.kind === "event" && !args.start && !args.end) throw new Error("reschedule event requires start or end");
    if (item.kind !== "event" && !args.due) throw new Error("reschedule task/reminder requires due");
    const updated = item.kind === "event"
      ? updateEventDates(item.raw, { start: args.start, end: args.end })
      : updateTodoDates(item.raw, { due: args.due, reminderAt: item.kind === "reminder" ? args.due : undefined });
    await this.putRaw(item.href, updated);
    return parsePlannerItem(updated, item.href)!;
  }

  private async put(uid: string, ics: string): Promise<void> {
    await this.putRaw(this.hrefForUid(uid), ics);
  }

  private async putRaw(href: string, ics: string): Promise<void> {
    await request(new URL(href, this.baseUrl).toString(), {
      method: "PUT",
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
      body: ics,
    }, [200, 201, 204]);
  }

  private hrefForUid(uid: string): string {
    return new URL(`${encodeURIComponent(uid)}.ics`, this.collectionUrl).toString();
  }
}

function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

// ---------- RRULE helpers ----------

function localDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isDateOnlyString(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function occurrenceValue(date: Date, dateOnly: boolean): string {
  return dateOnly ? date.toISOString().slice(0, 10) : date.toISOString();
}

/** Build DTSTART string for rrulestr — handles date-only and datetime formats. */
function buildDtstart(dateStr: string): string {
  // date-only (YYYY-MM-DD or YYYYMMDD). rrule does not honor DTSTART;VALUE=DATE,
  // so use the compact date form to avoid defaulting DTSTART to "now".
  if (/^\d{4}-?\d{2}-?\d{2}$/.test(dateStr)) {
    const compact = dateStr.replace(/-/g, "");
    return `DTSTART:${compact}`;
  }
  // datetime: convert to compact UTC form for rrule
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return `DTSTART:${dateStr.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  return `DTSTART:${d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

/** Expand a recurring item into virtual occurrences within [windowStart, windowEnd). */
function expandRrule(item: PlannerItem, windowStart: Date, windowEnd: Date): PlannerItem[] {
  const dtstart = item.due ?? item.start ?? item.alarmAt;
  if (!dtstart) return [item];
  try {
    const rule = rrulestr(`${buildDtstart(dtstart)}\nRRULE:${item.rrule!}`);
    const dates = rule.between(windowStart, windowEnd, true);
    if (dates.length === 0) return [];
    const dateOnly = isDateOnlyString(dtstart);
    return dates.map((d) => {
      const occurrence = occurrenceValue(d, dateOnly);
      return {
        ...item,
        uid: `${item.uid}@${d.toISOString().slice(0, 10)}`,
        due: item.kind !== "event" ? occurrence : undefined,
        start: item.kind === "event" ? occurrence : undefined,
        alarmAt: item.kind === "reminder" ? occurrence : item.alarmAt,
        // virtual occurrences should not carry the raw ICS (use base item.uid for mutations)
        raw: item.raw,
      };
    });
  } catch {
    return [item]; // invalid RRULE — treat as non-recurring
  }
}

/** Return the next occurrence of a recurring item strictly after afterDate, or null if exhausted. */
function nextDueAfter(item: PlannerItem, afterDate: Date): Date | null {
  const dtstart = item.due ?? item.start ?? item.alarmAt;
  if (!dtstart) return null;
  try {
    const rule = rrulestr(`${buildDtstart(dtstart)}\nRRULE:${item.rrule!}`);
    return rule.after(afterDate, false);
  } catch {
    return null;
  }
}

async function request(url: string, init: RequestInit, okStatuses: number[]): Promise<Response> {
  const response = await fetch(url, init);
  if (!okStatuses.includes(response.status)) {
    const body = await response.text().catch(() => "");
    throw new Error(`${init.method ?? "GET"} ${url} failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }
  return response;
}

async function requestText(url: string, init: RequestInit, okStatuses: number[]): Promise<string> {
  return request(url, init, okStatuses).then((response) => response.text());
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parseMultistatus(xml: string): Array<{ href: string; ics: string }> {
  const results: Array<{ href: string; ics: string }> = [];
  const responses = xml.match(/<[^:>]*(?::)?response[\s\S]*?<\/[^:>]*(?::)?response>/g) ?? [];
  for (const response of responses) {
    const href = /<[^:>]*(?::)?href>([\s\S]*?)<\/[^:>]*(?::)?href>/.exec(response)?.[1];
    const data = /<[^:>]*(?::)?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*(?::)?calendar-data>/.exec(response)?.[1];
    if (href && data) results.push({ href: decodeXml(href), ics: decodeXml(data) });
  }
  return results;
}

function filterView(items: PlannerItem[], view: "all" | "today" | "upcoming" | "overdue"): PlannerItem[] {
  const today = todayStamp();
  if (view === "all") return items;
  if (view === "overdue") return items.filter((item) => item.status === "open" && itemDate(item) && itemDate(item)!.slice(0, 10) < today);
  if (view === "today") return items.filter((item) => item.status === "open" && itemDate(item)?.slice(0, 10) === today);
  return items.filter((item) => item.status === "open" && (itemDate(item)?.slice(0, 10) ?? "") >= today);
}

function itemDate(item: PlannerItem): string | undefined {
  return item.alarmAt ?? item.due ?? item.start;
}

function compareItems(a: PlannerItem, b: PlannerItem): number {
  const aDate = itemDate(a) ?? "9999";
  const bDate = itemDate(b) ?? "9999";
  return aDate.localeCompare(bDate) || a.title.localeCompare(b.title);
}
