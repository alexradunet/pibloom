/**
 * os — OS management: NixOS lifecycle, systemd, health, and updates.
 *
 * @tools nixos_update, nix_config_proposal, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start, tool_call
 * @see {@link ../../AGENTS.md#os} Extension reference
 */
import { readFile } from "node:fs/promises";
import { StringEnum } from "@mariozechner/pi-ai";
import { type ExtensionAPI, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { EmptyToolParams, type RegisteredExtensionTool, registerTools, toToolResult } from "../../../lib/utils.js";
import {
	checkBootstrapDisable,
	checkPendingUpdates,
	handleNixosUpdate,
	handleScheduleReboot,
	handleSystemdControl,
	handleUpdateStatus,
} from "./actions.js";
import { handleSystemHealth } from "./actions-health.js";
import { handleNixConfigProposal } from "./actions-proposal.js";

const NixosUpdateParams = Type.Object({
	action: StringEnum(["status", "apply", "rollback"] as const, {
		description:
			"status: list NixOS generations. apply: run nixos-rebuild switch through the installed /etc/nixos host flake. rollback: revert to previous generation.",
	}),
});

const NixConfigProposalParams = Type.Object({
	action: StringEnum(["setup", "status", "validate", "commit", "push", "apply"] as const, {
		description:
			"setup: initialize the local NixPI repository explicitly. status: inspect branch, remote, and local Nix-related diff. validate: run local flake and config checks. commit: create a Git commit for local changes. push: publish the current branch to origin. apply: deploy the local repository state to the host.",
	}),
});

const SystemdControlParams = Type.Object({
	service: Type.String({ description: "Service name (e.g. nixpi-update)" }),
	action: StringEnum(["start", "stop", "restart", "status"] as const),
});

const UpdateStatusParams = EmptyToolParams;

const ScheduleRebootParams = Type.Object({
	delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
});

const SystemHealthParams = EmptyToolParams;

export default function (pi: ExtensionAPI) {
	const tools: RegisteredExtensionTool[] = [
		{
			name: "nixos_update",
			label: "NixOS Update Management",
			description:
				"Manage NixOS OS updates: view generation history, apply the installed host flake, or rollback to the previous generation.",
			parameters: NixosUpdateParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof NixosUpdateParams>;
				return toToolResult(await handleNixosUpdate(p.action, signal, ctx));
			},
		},
		{
			name: "nix_config_proposal",
			label: "Local Nix Config Proposal",
			description:
				"Inspect, initialize, validate, commit, push, and apply changes from the local NixPI repository used as the canonical authoring surface.",
			parameters: NixConfigProposalParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof NixConfigProposalParams>;
				return toToolResult(await handleNixConfigProposal(p.action, signal, ctx));
			},
		},
		{
			name: "systemd_control",
			label: "Systemd Service Control",
			description: "Manage a NixPI user-systemd service (start, stop, restart, status). Only nixpi-* services allowed.",
			parameters: SystemdControlParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof SystemdControlParams>;
				return toToolResult(await handleSystemdControl(p.service, p.action, signal, ctx));
			},
		},
		{
			name: "update_status",
			label: "Update Status",
			description: "Reads the NixPI update status from the last scheduled check.",
			parameters: UpdateStatusParams,
			async execute() {
				return toToolResult(await handleUpdateStatus());
			},
		},
		{
			name: "schedule_reboot",
			label: "Schedule Reboot",
			description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
			parameters: ScheduleRebootParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof ScheduleRebootParams>;
				return toToolResult(await handleScheduleReboot(p.delay_minutes, signal, ctx));
			},
		},
		{
			name: "system_health",
			label: "System Health",
			description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
			parameters: SystemHealthParams,
			async execute(_toolCallId, _params, signal) {
				return toToolResult(await handleSystemHealth(signal));
			},
		},
	];
	registerTools(pi, tools);

	pi.on("tool_call", async (event) => {
		if (isToolCallEventType("write", event)) {
			return checkBootstrapDisable(event.input.path, event.input.content);
		}

		if (isToolCallEventType("edit", event)) {
			let currentContent: string;
			try {
				currentContent = await readFile(event.input.path, "utf-8");
			} catch {
				return undefined;
			}
			const legacyEditInput = event.input as { oldText?: string; newText?: string };
			const edits = Array.isArray(event.input.edits)
				? event.input.edits
				: [{ oldText: legacyEditInput.oldText ?? "", newText: legacyEditInput.newText ?? "" }];
			const postEditContent = edits.reduce((content, edit) => {
				return content.replaceAll(edit.oldText, edit.newText);
			}, currentContent);
			return checkBootstrapDisable(event.input.path, postEditContent);
		}
	});

	let updateChecked = false;

	pi.on("before_agent_start", async (event) => {
		if (updateChecked) return;
		updateChecked = true;
		return checkPendingUpdates(event.systemPrompt);
	});
}
