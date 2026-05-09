import { el, prepareList, setListEmpty } from "../../dom.js";
import { actionButton } from "../atoms.js";
import { actionRow } from "../molecules.js";

export function renderDeliveries(target, deliveries, { admin }) {
  if (!deliveries.length) {
    setListEmpty(target);
    return;
  }
  prepareList(target);
  for (const delivery of deliveries) {
    const id = delivery.id ?? "";
    const status = delivery.deadAt ? "dead" : delivery.nextAttemptAt ? "waiting" : "queued";
    const recipient = delivery.recipientId ?? delivery.target ?? delivery.recipient ?? "local gateway";
    const retryButton = admin ? actionButton("Retry", { deliveryRetry: id }, { class: "small-button secondary outline", "aria-label": `Retry delivery ${id}` }) : null;
    const deleteButton = admin ? actionButton("Delete", { deliveryDelete: id }, { class: "small-button button-danger", "aria-label": `Delete delivery ${id}` }) : null;
    target.append(deliveryItem({ id, status, recipient, nextAttemptAt: delivery.nextAttemptAt, deadAt: delivery.deadAt }, actionRow([retryButton, deleteButton])));
  }
}

function deliveryItem(delivery, actions) {
  const statusClass = delivery.status === "dead" ? "error" : delivery.status === "waiting" ? "warning" : "system";
  const timing = delivery.deadAt ? `dead at ${delivery.deadAt}` : delivery.nextAttemptAt ? `next ${delivery.nextAttemptAt}` : "queued for delivery";
  return el("li", {
    className: `item queue-item queue-${delivery.status}`,
    children: [
      el("div", {
        className: "item-header",
        children: [
          el("div", {
            className: "item-title",
            children: [
              el("strong", { text: delivery.id ? `Delivery ${delivery.id}` : "Delivery" }),
              el("small", { text: delivery.recipient }),
            ],
          }),
          el("span", { className: `chip status-chip status-chip-${statusClass}`, text: delivery.status }),
        ],
      }),
      el("small", { text: timing }),
      actions,
    ],
  });
}
