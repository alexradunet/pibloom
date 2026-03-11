/**
 * bloom-channels — Matrix client bridge for Pi messaging.
 *
 * Connects directly to the local Continuwuity homeserver via matrix-bot-sdk.
 * Pi logs in as @pi:bloom and listens for messages in Matrix rooms.
 *
 * @commands /matrix (send message via Matrix)
 * @hooks session_start, agent_end, session_shutdown
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createMatrixBridge } from "./actions.js";

export { registerMatrixAccount } from "./actions.js";

export default function (pi: ExtensionAPI) {
	const bridge = createMatrixBridge(pi);

	pi.on("session_start", (event, ctx) => {
		bridge.handleSessionStart(event, ctx);
	});

	pi.on("agent_end", (event, ctx) => {
		bridge.handleAgentEnd(event, ctx);
	});

	pi.on("session_shutdown", (event, ctx) => {
		bridge.handleSessionShutdown(event, ctx);
	});

	pi.registerCommand("matrix", {
		description: "Send a message via Matrix",
		handler: async (args, ctx) => {
			await bridge.handleMatrixCommand(args, ctx);
		},
	});
}
