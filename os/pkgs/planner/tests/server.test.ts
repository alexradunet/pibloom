import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { startServer } from "../src/server.js";
import type { PlannerItem } from "../src/ical.js";

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no address"));
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function withPlannerServer(client: any, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const port = await findFreePort();
  const server = startServer({ port, listen: "127.0.0.1", client });
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function item(overrides: Partial<PlannerItem> = {}): PlannerItem {
  return {
    uid: "abc123",
    kind: "task",
    status: "open",
    title: "Test item",
    categories: [],
    ...overrides,
  };
}

test("planner server lists items as no-store JSON", async () => {
  const calls: unknown[] = [];
  const client = {
    list: async (view: string) => {
      calls.push(["list", view]);
      return [item({ due: "2026-06-01" })];
    },
  };

  await withPlannerServer(client, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/items?view=today`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = await response.json();
    assert.equal(body[0].title, "Test item");
  });
  assert.deepEqual(calls, [["list", "today"]]);
});

test("planner server creates tasks, reminders, and events", async () => {
  const calls: unknown[] = [];
  const client = {
    addTask: async (args: unknown) => {
      calls.push(["addTask", args]);
      return item({ kind: "task", title: "Task" });
    },
    addReminder: async (args: unknown) => {
      calls.push(["addReminder", args]);
      return item({ kind: "reminder", title: "Reminder" });
    },
    addEvent: async (args: unknown) => {
      calls.push(["addEvent", args]);
      return item({ kind: "event", title: "Event" });
    },
  };

  await withPlannerServer(client, async (baseUrl) => {
    for (const body of [
      { kind: "task", title: "Task", due: "2026-06-01", priority: 3, categories: ["work"], repeat: "weekly" },
      { kind: "reminder", title: "Reminder", at: "2026-06-01T09:00", categories: "home" },
      { kind: "event", title: "Event", start: "2026-06-01T10:00", end: "2026-06-01T11:00" },
    ]) {
      const response = await fetch(`${baseUrl}/api/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 201);
    }
  });

  assert.deepEqual(calls, [
    ["addTask", { title: "Task", description: undefined, due: "2026-06-01", priority: 3, categories: ["work"], rrule: "FREQ=WEEKLY" }],
    ["addReminder", { title: "Reminder", description: undefined, at: "2026-06-01T09:00", categories: ["home"], rrule: undefined }],
    ["addEvent", { title: "Event", description: undefined, start: "2026-06-01T10:00", end: "2026-06-01T11:00", categories: undefined, rrule: undefined }],
  ]);
});

test("planner server exposes item mutation routes", async () => {
  const calls: unknown[] = [];
  const client = {
    done: async (uid: string) => {
      calls.push(["done", uid]);
      return item({ uid, status: "done" });
    },
    snooze: async (uid: string, to: string) => {
      calls.push(["snooze", uid, to]);
      return item({ uid, kind: "reminder", alarmAt: to });
    },
    reschedule: async (uid: string, args: unknown) => {
      calls.push(["reschedule", uid, args]);
      return item({ uid });
    },
    edit: async (uid: string, args: unknown) => {
      calls.push(["edit", uid, args]);
      return item({ uid, title: "Edited" });
    },
    delete: async (uid: string) => {
      calls.push(["delete", uid]);
    },
  };

  await withPlannerServer(client, async (baseUrl) => {
    const done = await fetch(`${baseUrl}/api/items/abc123%402026-06-01/done`, { method: "POST" });
    assert.equal(done.status, 200);

    const snooze = await fetch(`${baseUrl}/api/items/rem123/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "2026-06-01T09:30" }),
    });
    assert.equal(snooze.status, 200);

    const reschedule = await fetch(`${baseUrl}/api/items/task123/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ due: "2026-06-02" }),
    });
    assert.equal(reschedule.status, 200);

    const edit = await fetch(`${baseUrl}/api/items/task123`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited", categories: ["work"] }),
    });
    assert.equal(edit.status, 200);

    const deleted = await fetch(`${baseUrl}/api/items/task123`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
  });

  assert.deepEqual(calls, [
    ["done", "abc123"],
    ["snooze", "rem123", "2026-06-01T09:30"],
    ["reschedule", "task123", { due: "2026-06-02", start: undefined, end: undefined }],
    ["edit", "task123", { title: "Edited", description: undefined, priority: undefined, categories: ["work"], addCategories: undefined, removeCategories: undefined, clearCategories: undefined }],
    ["delete", "task123"],
  ]);
});

test("planner server rejects non-loopback origins", async () => {
  const client = { list: async () => [] };
  await withPlannerServer(client, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/items`, { headers: { Origin: "http://evil.example" } });
    assert.equal(response.status, 421);
    assert.match(await response.text(), /Misdirected request/);
  });
});

test("planner server returns JSON validation errors", async () => {
  const client = {};
  await withPlannerServer(client, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "task" }),
    });
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.match(await response.text(), /title is required/);
  });
});
