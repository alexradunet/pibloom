const API_ROOT = "/api/planner";

export function createOrganizerController({ els, log }) {
  if (!els.plannerRefreshButton) return { refresh: async () => {} };

  let loading = false;

  async function request(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!response.ok) throw new Error(data?.error || `Planner request failed: HTTP ${response.status}`);
    return data;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    setStatus("loading…");
    els.plannerRefreshButton.disabled = true;
    try {
      const [overdue, today, upcoming, allItems] = await Promise.all([
        request("/items?view=overdue"),
        request("/items?view=today"),
        request("/items?view=upcoming"),
        request("/items?view=all"),
      ]);
      renderList(els.plannerOverdueList, overdue, "No overdue planner items.");
      renderList(els.plannerTodayList, today, "No planner items for today.");
      renderList(els.plannerUpcomingList, upcoming.filter((item) => !isToday(item)), "No upcoming planner items.");
      renderList(els.plannerUndatedList, allItems.filter(isOpenUndated), "No undated planner items.");
      setStatus(`updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      log?.("planner refreshed");
    } catch (error) {
      setStatus(error.message || String(error), "error");
      renderError(els.plannerOverdueList, error);
      renderError(els.plannerTodayList, error);
      renderError(els.plannerUpcomingList, error);
      renderError(els.plannerUndatedList, error);
      log?.("planner refresh failed", error.message || String(error));
    } finally {
      loading = false;
      els.plannerRefreshButton.disabled = false;
    }
  }

  async function addItem(event) {
    event.preventDefault();
    const kind = els.plannerKind.value;
    const title = els.plannerTitle.value.trim();
    const when = els.plannerWhen.value.trim();
    if (!title) {
      setStatus("title is required", "error");
      els.plannerTitle.focus();
      return;
    }

    const body = {
      kind,
      title,
      description: emptyToUndefined(els.plannerDescription.value),
      categories: splitCategories(els.plannerCategories.value),
      repeat: emptyToUndefined(els.plannerRepeat.value),
    };

    if (kind === "task") {
      body.due = emptyToUndefined(when);
      body.priority = emptyToNumber(els.plannerPriority.value);
    } else if (kind === "reminder") {
      if (!when) return requireWhen("Reminder time is required.");
      body.at = when;
    } else if (kind === "event") {
      if (!when) return requireWhen("Event start is required.");
      body.start = when;
      body.end = emptyToUndefined(els.plannerEnd.value);
    }

    try {
      setStatus("adding…");
      await request("/items", { method: "POST", body: JSON.stringify(compactObject(body)) });
      els.plannerForm.reset();
      updateFormForKind();
      await refresh();
    } catch (error) {
      setStatus(error.message || String(error), "error");
      log?.("planner add failed", error.message || String(error));
    }
  }

  function requireWhen(message) {
    setStatus(message, "error");
    els.plannerWhen.focus();
  }

  async function handleListClick(event) {
    const button = event.target instanceof HTMLElement ? event.target.closest("[data-planner-action]") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const itemEl = button.closest("[data-planner-uid]");
    if (!(itemEl instanceof HTMLElement)) return;

    const uid = itemEl.dataset.plannerUid;
    const kind = itemEl.dataset.plannerKind;
    const action = button.dataset.plannerAction;
    if (!uid || !kind || !action) return;

    try {
      button.disabled = true;
      if (action === "done") {
        await request(`/items/${encodeURIComponent(uid)}/done`, { method: "POST" });
      } else if (action === "delete") {
        if (!confirm(`Delete planner item “${itemEl.dataset.plannerTitle || uid}”?`)) return;
        await request(`/items/${encodeURIComponent(uid)}`, { method: "DELETE" });
      } else if (action === "snooze") {
        const next = prompt("Snooze until (date/time):", itemEl.dataset.plannerDate || "");
        if (!next) return;
        await request(`/items/${encodeURIComponent(uid)}/snooze`, { method: "POST", body: JSON.stringify({ to: next }) });
      } else if (action === "reschedule") {
        const next = prompt(kind === "event" ? "New start date/time:" : "New due date/time:", itemEl.dataset.plannerDate || "");
        if (!next) return;
        let body = kind === "event" ? { start: next } : { due: next };
        if (kind === "event") {
          const endDefault = defaultMovedEnd(itemEl.dataset.plannerDate || "", itemEl.dataset.plannerEnd || "", next);
          const nextEnd = prompt("New end date/time (optional):", endDefault);
          if (nextEnd === null) return;
          body = compactObject({ ...body, end: emptyToUndefined(nextEnd) });
        }
        await request(`/items/${encodeURIComponent(uid)}/reschedule`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else if (action === "edit") {
        const title = prompt("Title:", itemEl.dataset.plannerTitle || "");
        if (title === null) return;
        const description = prompt("Description:", itemEl.dataset.plannerDescription || "");
        if (description === null) return;
        const categories = prompt("Categories (comma-separated):", itemEl.dataset.plannerCategories || "");
        if (categories === null) return;
        await request(`/items/${encodeURIComponent(uid)}`, {
          method: "PATCH",
          body: JSON.stringify({ title, description, categories: splitCategories(categories) }),
        });
      }
      await refresh();
    } catch (error) {
      setStatus(error.message || String(error), "error");
      log?.("planner action failed", error.message || String(error));
    } finally {
      button.disabled = false;
    }
  }

  function updateFormForKind() {
    const kind = els.plannerKind.value;
    els.plannerWhenText.textContent = kind === "event" ? "Start" : kind === "reminder" ? "Remind at" : "Due";
    els.plannerWhen.required = kind === "event" || kind === "reminder";
    els.plannerEndLabel.hidden = kind !== "event";
    els.plannerPriorityLabel.hidden = kind !== "task";
  }

  els.plannerRefreshButton.addEventListener("click", refresh);
  els.plannerForm.addEventListener("submit", addItem);
  els.plannerKind.addEventListener("change", updateFormForKind);
  for (const list of [els.plannerOverdueList, els.plannerTodayList, els.plannerUpcomingList, els.plannerUndatedList]) {
    list.addEventListener("click", handleListClick);
  }
  updateFormForKind();

  return { refresh };
}

function renderList(container, items, emptyText) {
  updatePlannerCount(container, items.length);
  container.replaceChildren();
  container.classList.toggle("empty", items.length === 0);
  if (items.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    container.append(li);
    return;
  }

  for (const item of items) {
    container.append(renderPlannerItem(item));
  }
}

function renderPlannerItem(item) {
  const li = document.createElement("li");
  const uid = actionUid(item.uid);
  const date = item.alarmAt || item.due || item.start || "";
  li.className = ["item", "planner-item", `planner-item-${item.kind}`, item.status ? `planner-status-${item.status}` : ""].filter(Boolean).join(" ");
  li.dataset.plannerUid = uid;
  li.dataset.plannerKind = item.kind;
  li.dataset.plannerTitle = item.title || "";
  li.dataset.plannerDescription = item.description || "";
  li.dataset.plannerCategories = visibleCategories(item).join(", ");
  li.dataset.plannerDate = date;
  li.dataset.plannerEnd = item.end || "";

  const header = document.createElement("div");
  header.className = "planner-item-header";

  const titleBlock = document.createElement("div");
  titleBlock.className = "planner-item-title";
  const title = document.createElement("strong");
  title.textContent = item.title || "(untitled)";
  const meta = document.createElement("small");
  meta.textContent = [item.kind, formatDate(date), item.rrule ? "repeats" : "", item.priority ? `P${item.priority}` : ""].filter(Boolean).join(" · ");
  titleBlock.append(title, meta);

  const chip = document.createElement("span");
  chip.className = `chip planner-kind planner-kind-${item.kind}`;
  chip.textContent = item.kind;
  header.append(titleBlock, chip);
  li.append(header);

  if (item.description) {
    const desc = document.createElement("p");
    desc.className = "planner-description";
    desc.textContent = item.description;
    li.append(desc);
  }

  const categories = visibleCategories(item);
  if (categories.length) {
    const cats = document.createElement("small");
    cats.className = "planner-categories";
    cats.textContent = categories.join(", ");
    li.append(cats);
  }

  const actions = document.createElement("div");
  actions.className = "row planner-actions";
  if (item.status !== "done" && item.kind !== "event") actions.append(actionButton("done", "Done"));
  if (item.status !== "done" && item.kind === "reminder") actions.append(actionButton("snooze", "Snooze"));
  if (item.status !== "done") actions.append(actionButton("reschedule", item.kind === "event" ? "Move" : "Reschedule"));
  actions.append(actionButton("edit", "Edit"));
  actions.append(actionButton("delete", "Delete", "button-danger"));
  li.append(actions);

  return li;
}

function actionButton(action, label, extraClass = "secondary outline") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `small-button ${extraClass}`;
  button.dataset.plannerAction = action;
  button.textContent = label;
  return button;
}

function renderError(container, error) {
  updatePlannerCount(container, "error");
  container.replaceChildren();
  container.classList.add("empty");
  const li = document.createElement("li");
  li.textContent = error.message || String(error);
  container.append(li);
}

function updatePlannerCount(container, value) {
  const count = container.closest(".planner-list-card")?.querySelector("[data-planner-count]");
  if (count) count.textContent = String(value);
}

function setStatus(text, className = "") {
  const status = document.getElementById("plannerStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("error", className === "error");
  status.classList.toggle("loading", text === "loading…");
}

function actionUid(uid) {
  return String(uid || "").replace(/@\d{4}-\d{2}-\d{2}$/, "");
}

function visibleCategories(item) {
  return (item.categories || []).filter((category) => category !== "reminder");
}

function itemDate(item) {
  return item.alarmAt || item.due || item.start || "";
}

function isOpenUndated(item) {
  return item.status === "open" && !itemDate(item);
}

function isToday(item) {
  return itemDate(item).slice(0, 10) === todayStamp();
}

function todayStamp() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function defaultMovedEnd(oldStart, oldEnd, nextStart) {
  if (!oldStart || !oldEnd) return oldEnd || "";
  const oldStartDate = new Date(oldStart);
  const oldEndDate = new Date(oldEnd);
  const nextStartDate = new Date(nextStart);
  if ([oldStartDate, oldEndDate, nextStartDate].some((date) => Number.isNaN(date.getTime()))) return oldEnd;
  return formatForDateTimeLocal(new Date(nextStartDate.getTime() + oldEndDate.getTime() - oldStartDate.getTime()));
}

function formatForDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(value) {
  if (!value) return "no date";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function splitCategories(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function emptyToUndefined(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : undefined;
}

function emptyToNumber(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? Number(trimmed) : undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && !(Array.isArray(entry) && entry.length === 0)));
}
