import { prepareList, setListEmpty } from "../../dom.js";
import { actionButton } from "../atoms.js";
import { actionRow, titleMetaItem } from "../molecules.js";

export function renderSessions(target, sessions, options) {
  if (!sessions.length) {
    setListEmpty(target);
    return;
  }
  prepareList(target);
  for (const session of sessions) {
    const chatId = session.chatId ?? session.id ?? "session";
    const current = chatId === options.currentChatId;
    const switchLabel = chatId.startsWith("client:") ? "Switch" : "Attach";
    const switchButton = current ? null : actionButton(switchLabel, { sessionSwitchChat: chatId }, {
      class: "small-button secondary outline",
      disabled: options.agentRunning,
      "aria-label": `${switchLabel} to ${options.sessionTitle(chatId)}`,
    });
    const resetButton = options.admin ? actionButton("Reset", { sessionReset: chatId }, {
      class: "small-button button-danger",
      disabled: options.agentRunning,
      "aria-label": `Reset ${options.sessionTitle(chatId)}`,
    }) : null;
    const badge = current ? " · current" : "";
    const meta = `${chatId}${badge} · ${session.updatedAt ?? session.createdAt ?? ""}`;
    target.append(titleMetaItem(options.sessionTitle(chatId), meta, actionRow([switchButton, resetButton])));
  }
}
