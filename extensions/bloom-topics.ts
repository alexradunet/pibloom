/**
 * 🗂️ bloom-topics — Conversation topic management and session organization.
 *
 * @commands /topic (new | close | list | switch)
 * @hooks session_start, before_agent_start
 * @see {@link ../AGENTS.md#bloom-topics} Extension reference
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/** Metadata for a conversation topic within a session. */
interface TopicInfo {
	name: string;
	status: "active" | "closed";
	branchPoint: string | undefined;
}

export default function (pi: ExtensionAPI) {
	let lastCtx: ExtensionContext | null = null;

	function getTopics(): TopicInfo[] {
		if (!lastCtx) return [];
		const entries = lastCtx.sessionManager.getEntries();
		const topics = new Map<string, TopicInfo>();
		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType === "bloom-topic") {
				const data = (entry as { type: "custom"; customType: string; data?: unknown }).data as
					| { name?: string; status?: string; branchPoint?: string }
					| undefined;
				if (data?.name) {
					topics.set(data.name, {
						name: data.name,
						status: (data.status as "active" | "closed") ?? "active",
						branchPoint: data.branchPoint,
					});
				}
			}
		}
		return Array.from(topics.values());
	}

	function getActiveTopic(): TopicInfo | null {
		const topics = getTopics();
		const active = topics.filter((t) => t.status === "active");
		return active.length > 0 ? (active[active.length - 1] ?? null) : null;
	}

	pi.on("session_start", (_event, ctx) => {
		lastCtx = ctx;
	});

	pi.on("before_agent_start", async (event) => {
		const topicGuidance = [
			"",
			"## Topic Management",
			"",
			"You have topic management commands available:",
			"- `/topic new <name>` — Start a new conversation topic (e.g. `/topic new deploy-planning`)",
			"- `/topic close` — Close the current topic and summarize it",
			"- `/topic list` — Show all topics and their status",
			"- `/topic switch <name>` — Switch to an existing topic",
			"",
			"When you notice the conversation shifting to a distinctly different subject:",
			'- Suggest starting a new topic: "This seems like a new topic. You could use `/topic new <suggested-name>` to track it separately."',
			"- Do NOT auto-create topics — always suggest and let the user decide.",
			"- If the user ignores the suggestion, continue normally without repeating it.",
		].join("\n");
		return { systemPrompt: event.systemPrompt + topicGuidance };
	});

	pi.registerCommand("topic", {
		description: "Manage conversation topics: /topic new <name> | close | list | switch <name>",
		handler: async (args: string, ctx) => {
			lastCtx = ctx;
			const parts = args.trim().split(/\s+/);
			const sub = parts[0] ?? "";
			const name = parts.slice(1).join(" ");

			switch (sub) {
				case "new": {
					if (!name) {
						ctx.ui.notify("Usage: /topic new <name>", "warning");
						return;
					}
					const leaf = ctx.sessionManager.getLeafEntry();
					const branchPoint = leaf?.id;
					pi.appendEntry("bloom-topic", { name, status: "active", branchPoint });
					ctx.ui.notify(`Topic started: ${name}`, "info");
					pi.sendUserMessage(
						`We are now focusing on a new topic: "${name}". Please keep your responses focused on this topic until it is closed.`,
						{ deliverAs: "followUp" },
					);
					break;
				}

				case "close": {
					const active = getActiveTopic();
					if (!active) {
						ctx.ui.notify("No active topic to close.", "warning");
						return;
					}
					pi.appendEntry("bloom-topic", {
						name: active.name,
						status: "closed",
						branchPoint: active.branchPoint,
					});
					ctx.ui.notify(`Topic closed: ${active.name}`, "info");
					pi.sendUserMessage(
						`The topic "${active.name}" is now closed. Please summarize what was discussed and accomplished, then return to the main conversation.`,
						{ deliverAs: "followUp" },
					);
					break;
				}

				case "list": {
					const topics = getTopics();
					if (topics.length === 0) {
						ctx.ui.notify("No topics found in this session.", "info");
						return;
					}
					const lines = topics.map((t) => `${t.status === "active" ? "* " : "  "}${t.name} [${t.status}]`);
					ctx.ui.notify(lines.join("\n"), "info");
					break;
				}

				case "switch": {
					if (!name) {
						ctx.ui.notify("Usage: /topic switch <name>", "warning");
						return;
					}
					const topics = getTopics();
					const target = topics.find((t) => t.name === name);
					if (!target) {
						ctx.ui.notify(`Topic not found: ${name}`, "warning");
						return;
					}
					if (target.branchPoint) {
						const result = await ctx.navigateTree(target.branchPoint, {
							summarize: true,
							label: `topic: ${name}`,
						});
						if (result.cancelled) {
							ctx.ui.notify(`Switch to topic "${name}" was cancelled.`, "warning");
							return;
						}
					}
					pi.appendEntry("bloom-topic", {
						name,
						status: "active",
						branchPoint: target.branchPoint,
					});
					ctx.ui.notify(`Switched to topic: ${name}`, "info");
					break;
				}

				default: {
					ctx.ui.notify("Usage: /topic new <name> | close | list | switch <name>", "info");
					break;
				}
			}
		},
	});
}
