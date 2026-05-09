import { el, prepareList, setListEmpty } from "../../dom.js";
import { actionButton } from "../atoms.js";
import { actionRow } from "../molecules.js";

export function renderClients(target, payload) {
  const rows = normalizeClientRows(payload);
  if (!rows.length) {
    setListEmpty(target);
    return;
  }

  const admin = (payload.current?.scopes ?? []).includes("admin");
  prepareList(target);
  for (const client of rows) {
    const name = client.identity?.displayName ?? client.displayName ?? client.clientId ?? client.id ?? client.connId ?? "client";
    const rotateButton = admin && !client.current && client.canRotate
      ? actionButton("Rotate token", { clientRotate: client.id }, { class: "small-button secondary outline", "aria-label": `Rotate token for ${name}` })
      : null;
    const revokeButton = admin && !client.current && client.canRevoke
      ? actionButton("Revoke", { clientRevoke: client.id }, { class: "small-button button-danger", "aria-label": `Revoke ${name}` })
      : null;
    target.append(clientItem(client, name, actionRow([rotateButton, revokeButton])));
  }
}

function clientItem(client, name, actions) {
  const status = clientStatus(client);
  const scopes = client.identity?.scopes ?? client.scopes ?? [];
  const details = [client.id ?? client.clientId ?? client.connId, client.connId ? `conn ${client.connId}` : ""].filter(Boolean).join(" · ");
  const chips = [
    statusChip(clientManagedLabel(client), client.revokedAt ? "error" : "system"),
    ...scopes.map((scope) => statusChip(scope, "neutral")),
  ];
  if (client.tokenPreview && !client.revokedAt) chips.push(statusChip(`token ${maskTokenPreview(client.tokenPreview)}`, "system"));

  return el("li", {
    className: `item client-item client-item-${status.slug}`,
    children: [
      el("div", {
        className: "item-header",
        children: [
          el("div", {
            className: "item-title",
            children: [
              el("strong", { text: name }),
              el("small", { text: details || "gateway client" }),
            ],
          }),
          statusChip(status.label, status.variant),
        ],
      }),
      el("div", { className: "chip-row", children: chips }),
      actions,
    ],
  });
}

function statusChip(label, variant) {
  const suffix = variant === "neutral" ? "" : ` status-chip-${variant}`;
  return el("span", { className: `chip status-chip${suffix}`, text: label });
}

function normalizeClientRows(payload) {
  const rows = (payload.clients ?? []).map((client) => ({ ...client }));
  const currentScopes = payload.current?.scopes ?? [];
  const currentIdentityId = payload.current?.identity?.id ?? null;
  const currentClientId = payload.current?.clientId ?? null;
  let markedCurrent = false;

  for (const row of rows) {
    if ((currentIdentityId && row.id === currentIdentityId) || (!currentIdentityId && currentClientId && row.id === currentClientId)) {
      row.current = true;
      markedCurrent = true;
      break;
    }
  }

  if (payload.current && !markedCurrent) {
    rows.unshift({
      id: currentIdentityId ?? currentClientId ?? payload.current.connId,
      displayName: payload.current.identity?.displayName ?? currentClientId ?? "Current connection",
      scopes: currentScopes,
      managedBy: "connection",
      current: true,
      connId: payload.current.connId,
    });
  }

  return rows;
}

function clientStatus(client) {
  if (client.revokedAt) return { label: "Revoked", variant: "error", slug: "revoked" };
  if (client.current) return { label: "Current", variant: "success", slug: "current" };
  if (client.managedBy === "runtime") return { label: "Paired browser", variant: "system", slug: "paired" };
  if (client.managedBy === "config") return { label: "Config-managed", variant: "warning", slug: "config" };
  return { label: "Connection", variant: "neutral", slug: "connection" };
}

function clientManagedLabel(client) {
  if (client.revokedAt) return "revoked";
  if (client.managedBy === "runtime") return "paired browser";
  if (client.managedBy === "config") return "config managed";
  if (client.managedBy) return client.managedBy;
  return "connection";
}

function maskTokenPreview(value) {
  const preview = String(value || "").trim();
  if (!preview) return "masked";
  if (preview.includes("…") || preview.includes("...")) return preview;
  if (preview.length <= 4) return "••••";
  return `${preview.slice(0, 4)}…${preview.slice(-2)}`;
}
