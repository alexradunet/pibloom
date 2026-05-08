import assert from "node:assert/strict";
import test from "node:test";
import { PlannerClient } from "../src/caldav.js";
import { eventIcs, todoIcs } from "../src/ical.js";

function multistatus(href: string, ics: string): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat><D:prop><C:calendar-data>${ics
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</C:calendar-data></D:prop></D:propstat>
  </D:response>
</D:multistatus>`;
}

test("list upcoming includes reminders by VALARM alarmAt without DUE", async () => {
  const originalFetch = globalThis.fetch;
  const ics = todoIcs({ uid: "rem-alarm-only", title: "Alarm only", reminderAt: "2999-05-07T08:30:00Z" });
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "REPORT") return new Response(multistatus("/alex/planner/rem-alarm-only.ics", ics), { status: 207 });
    return new Response("", { status: 201 });
  };
  try {
    const client = new PlannerClient({ baseUrl: "http://127.0.0.1:5232/", user: "alex", collection: "planner" });
    const items = await client.list("upcoming");
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "reminder");
    assert.equal(items[0]?.alarmAt, "2999-05-07T08:30:00Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reschedule updates reminder VALARM when due changes", async () => {
  const originalFetch = globalThis.fetch;
  const ics = todoIcs({ uid: "rem-resched", title: "Reschedule me", due: "2999-05-07T08:30:00Z", reminderAt: "2999-05-07T08:30:00Z" });
  let putBody = "";
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "REPORT") return new Response(multistatus("/alex/planner/rem-resched.ics", ics), { status: 207 });
    if (init?.method === "PUT") {
      putBody = String(init.body);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 201 });
  };
  try {
    const client = new PlannerClient({ baseUrl: "http://127.0.0.1:5232/", user: "alex", collection: "planner" });
    const item = await client.reschedule("rem-resched", { due: "2999-05-08T09:00:00Z" });
    assert.equal(item.due, "2999-05-08T09:00:00Z");
    assert.equal(item.alarmAt, "2999-05-08T09:00:00Z");
    assert.match(putBody, /DUE:29990508T090000Z/);
    assert.match(putBody, /TRIGGER;VALUE=DATE-TIME:29990508T090000Z/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reschedule rejects date fields that do not apply to the item kind", async () => {
  const originalFetch = globalThis.fetch;
  const ics = eventIcs({ uid: "event-noop", title: "Event", start: "2999-05-07T08:30:00Z", end: "2999-05-07T09:30:00Z" });
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "REPORT") return new Response(multistatus("/alex/planner/event-noop.ics", ics), { status: 207 });
    return new Response("", { status: 201 });
  };
  try {
    const client = new PlannerClient({ baseUrl: "http://127.0.0.1:5232/", user: "alex", collection: "planner" });
    await assert.rejects(() => client.reschedule("event-noop", { due: "2999-05-08" }), /reschedule event requires start or end/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("snooze is restricted to reminders", async () => {
  const originalFetch = globalThis.fetch;
  const ics = todoIcs({ uid: "plain-task", title: "Plain task" });
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "REPORT") return new Response(multistatus("/alex/planner/plain-task.ics", ics), { status: 207 });
    return new Response("", { status: 201 });
  };
  try {
    const client = new PlannerClient({ baseUrl: "http://127.0.0.1:5232/", user: "alex", collection: "planner" });
    await assert.rejects(() => client.snooze("plain-task", "2999-05-08T09:00:00Z"), /No reminder found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
