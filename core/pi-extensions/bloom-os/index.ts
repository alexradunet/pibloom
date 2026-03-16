/**
 * bloom-os — OS management: NixOS lifecycle, containers, systemd, health, updates.
 *
 * @tools nixos_update, container, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start
 * @see {@link ../../AGENTS.md#bloom-os} Extension reference
 */
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type RegisteredExtensionTool, defineTool, registerTools } from "../../lib/extension-tools.js";
import { handleSystemHealth } from "./actions-health.js";
import {
	checkPendingUpdates,
	handleNixosUpdate,
	handleContainer,
	handleScheduleReboot,
	handleSystemdControl,
	handleUpdateStatus,
} from "./actions.js";

export default function (pi: ExtensionAPI) {
	const tools: RegisteredExtensionTool[] = [
		defineTool({
			name: "nixos_update",
			label: "NixOS Update Management",
			description: "Manage NixOS OS updates: view generation history, apply a pending update, or rollback to the previous generation.",
			parameters: Type.Object({
				action: StringEnum(["status", "apply", "rollback"] as const, {
					description: "status: list NixOS generations. apply: run nixos-rebuild switch. rollback: revert to previous generation.",
				}),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typedParams = params as { action: "status" | "apply" | "rollback" };
				return handleNixosUpdate(typedParams.action, signal, ctx);
			},
		}),
		defineTool({
			name: "container",
			label: "Container Management",
			description: "Manage Bloom containers: list status, view logs, or deploy a Quadlet unit.",
			parameters: Type.Object({
				action: StringEnum(["status", "logs", "deploy"] as const, {
					description:
						"status: list running bloom-* containers. logs: view service logs. deploy: start a Quadlet unit.",
				}),
				service: Type.Optional(
					Type.String({ description: "Service name, required for logs/deploy (e.g. bloom-dufs)" }),
				),
				lines: Type.Optional(Type.Number({ description: "Log lines to return (default 50)", default: 50 })),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				return handleContainer(
					params as { action: "status" | "logs" | "deploy"; service?: string; lines?: number },
					signal,
					ctx,
				);
			},
		}),
		defineTool({
			name: "systemd_control",
			label: "Systemd Service Control",
			description: "Manage a Bloom user-systemd service (start, stop, restart, status). Only bloom-* services allowed.",
			parameters: Type.Object({
				service: Type.String({ description: "Service name (e.g. bloom-dufs)" }),
				action: StringEnum(["start", "stop", "restart", "status"] as const),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typedParams = params as { service: string; action: "start" | "stop" | "restart" | "status" };
				return handleSystemdControl(typedParams.service, typedParams.action, signal, ctx);
			},
		}),
		defineTool({
			name: "update_status",
			label: "Update Status",
			description: "Reads the Bloom OS update status from the last scheduled check.",
			parameters: Type.Object({}),
			async execute() {
				return handleUpdateStatus();
			},
		}),
		defineTool({
			name: "schedule_reboot",
			label: "Schedule Reboot",
			description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
			parameters: Type.Object({
				delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typedParams = params as { delay_minutes: number };
				return handleScheduleReboot(typedParams.delay_minutes, signal, ctx);
			},
		}),
		defineTool({
			name: "system_health",
			label: "System Health",
			description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, signal) {
				return handleSystemHealth(signal);
			},
		}),
	];
	registerTools(pi, tools);

	let updateChecked = false;

	pi.on("before_agent_start", async (event) => {
		if (updateChecked) return;
		updateChecked = true;
		return checkPendingUpdates(event.systemPrompt);
	});
}
