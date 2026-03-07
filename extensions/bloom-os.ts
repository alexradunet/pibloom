/**
 * 💻 bloom-os — OS management: bootc lifecycle, containers, systemd, health, updates.
 *
 * @tools bootc, container, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start
 * @see {@link ../AGENTS.md#bloom-os} Extension reference
 */
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { run } from "../lib/exec.js";
import { errorResult, guardBloom, requireConfirmation, truncate } from "../lib/shared.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "bootc",
		label: "Bootc Management",
		description: "Manage Fedora bootc OS image: status, check/download/apply updates, or rollback.",
		parameters: Type.Object({
			action: StringEnum(["status", "check", "download", "apply", "rollback"] as const, {
				description:
					"status: show image. check/download/apply: staged update workflow. rollback: revert to previous image.",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { action } = params;
			if (action === "download" || action === "apply" || action === "rollback") {
				const denied = await requireConfirmation(ctx, `OS ${action}`);
				if (denied) return errorResult(denied);
			}
			let cmd: string;
			let args: string[];
			switch (action) {
				case "status":
					cmd = "bootc";
					args = ["status"];
					break;
				case "check":
					cmd = "bootc";
					args = ["upgrade", "--check"];
					break;
				case "download":
					cmd = "sudo";
					args = ["bootc", "upgrade"];
					break;
				case "apply":
					cmd = "sudo";
					args = ["bootc", "upgrade", "--apply"];
					break;
				case "rollback":
					cmd = "sudo";
					args = ["bootc", "rollback"];
					break;
			}
			const result = await run(cmd, args, signal);
			let text: string;
			if (result.exitCode !== 0) {
				text = action === "status" ? `Error running bootc status:\n${result.stderr}` : `Error:\n${result.stderr}`;
			} else if (action === "rollback") {
				text = result.stdout || "Rollback staged. Reboot to apply.";
			} else {
				text = result.stdout || "No output.";
			}
			return {
				content: [{ type: "text", text: truncate(text) }],
				details: { exitCode: result.exitCode, action },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "container",
		label: "Container Management",
		description: "Manage Bloom containers: list status, view logs, or deploy a Quadlet unit.",
		parameters: Type.Object({
			action: StringEnum(["status", "logs", "deploy"] as const, {
				description: "status: list running bloom-* containers. logs: view service logs. deploy: start a Quadlet unit.",
			}),
			service: Type.Optional(
				Type.String({ description: "Service name, required for logs/deploy (e.g. bloom-whatsapp)" }),
			),
			lines: Type.Optional(Type.Number({ description: "Log lines to return (default 50)", default: 50 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { action, service } = params;

			if (action === "status") {
				const result = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
				if (result.exitCode !== 0) {
					return errorResult(`Error listing containers:\n${result.stderr}`);
				}
				let text: string;
				try {
					const containers = JSON.parse(result.stdout || "[]") as Array<{
						Names?: string[];
						Status?: string;
						State?: string;
						Image?: string;
					}>;
					if (containers.length === 0) {
						text = "No bloom-* containers are currently running.";
					} else {
						text = containers
							.map((c) => {
								const name = (c.Names ?? []).join(", ") || "unknown";
								const status = c.Status ?? c.State ?? "unknown";
								const image = c.Image ?? "unknown";
								return `${name}\n  status: ${status}\n  image:  ${image}`;
							})
							.join("\n\n");
					}
				} catch {
					text = result.stdout;
				}
				return { content: [{ type: "text", text: truncate(text) }], details: {} };
			}

			// logs and deploy both require a service name
			if (!service) {
				return errorResult(`The "${action}" action requires a service name.`);
			}
			const guard = guardBloom(service);
			if (guard) return errorResult(guard);

			if (action === "logs") {
				const n = String(params.lines ?? 50);
				const unit = `${service}.service`;
				const result = await run("journalctl", ["--user", "-u", unit, "--no-pager", "-n", n], signal);
				const text = truncate(
					result.exitCode === 0 ? result.stdout || "(no log output)" : `Error fetching logs:\n${result.stderr}`,
				);
				return {
					content: [{ type: "text", text }],
					details: { exitCode: result.exitCode },
					isError: result.exitCode !== 0,
				};
			}

			// action === "deploy"
			const unit = `${service}.service`;
			const denied = await requireConfirmation(ctx, `Deploy container ${unit}`);
			if (denied) return errorResult(denied);
			const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
			if (reload.exitCode !== 0) {
				return errorResult(`systemctl --user daemon-reload failed:\n${reload.stderr}`);
			}
			const start = await run("systemctl", ["--user", "start", unit], signal);
			const text = truncate(
				start.exitCode === 0 ? `Started ${unit} successfully.` : `Failed to start ${unit}:\n${start.stderr}`,
			);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: start.exitCode },
				isError: start.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "systemd_control",
		label: "Systemd Service Control",
		description: "Manage a Bloom user-systemd service (start, stop, restart, status). Only bloom-* services allowed.",
		parameters: Type.Object({
			service: Type.String({ description: "Service name (e.g. bloom-whatsapp)" }),
			action: StringEnum(["start", "stop", "restart", "status"] as const),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const guard = guardBloom(params.service);
			if (guard) return errorResult(guard);
			const unit = `${params.service}.service`;
			const readOnly = params.action === "status";
			if (!readOnly) {
				const denied = await requireConfirmation(ctx, `systemctl ${params.action} ${unit}`);
				if (denied) return errorResult(denied);
			}
			const result = await run("systemctl", ["--user", params.action, unit], signal);
			const text = truncate(result.stdout || result.stderr || `systemctl --user ${params.action} ${unit} completed.`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	// --- Update detection tools ---

	const bloomDir = join(os.homedir(), ".bloom");
	const statusFile = join(bloomDir, "update-status.json");

	pi.registerTool({
		name: "update_status",
		label: "Update Status",
		description: "Reads the Bloom OS update status from the last scheduled check.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const raw = await readFile(statusFile, "utf-8");
				const status = JSON.parse(raw);
				const text = status.available
					? `Update available (checked ${status.checked}). Version: ${status.version || "unknown"}`
					: `System is up to date (checked ${status.checked}).`;
				return { content: [{ type: "text", text }], details: status };
			} catch {
				return errorResult("No update status available. The update check timer may not have run yet.");
			}
		},
	});

	pi.registerTool({
		name: "schedule_reboot",
		label: "Schedule Reboot",
		description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
		parameters: Type.Object({
			delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const delay = Math.max(1, Math.round(params.delay_minutes));
			const denied = await requireConfirmation(ctx, `Schedule reboot in ${delay} minute(s)`);
			if (denied) return errorResult(denied);
			const result = await run("sudo", ["systemd-run", `--on-active=${delay}m`, "systemctl", "reboot"], signal);
			if (result.exitCode !== 0) {
				return errorResult(`Failed to schedule reboot:\n${result.stderr}`);
			}
			return {
				content: [{ type: "text", text: `Reboot scheduled in ${delay} minute(s).` }],
				details: { delay_minutes: delay },
			};
		},
	});

	pi.registerTool({
		name: "system_health",
		label: "System Health",
		description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const sections: string[] = [];

			const bootc = await run("bootc", ["status", "--format=json"], signal);
			if (bootc.exitCode === 0) {
				try {
					const status = JSON.parse(bootc.stdout) as {
						status?: { booted?: { image?: { image?: { image?: string; version?: string } } } };
					};
					const img = status?.status?.booted?.image?.image;
					sections.push(`## OS Image\n- Image: ${img?.image ?? "unknown"}\n- Version: ${img?.version ?? "unknown"}`);
				} catch {
					sections.push(`## OS Image\n${bootc.stdout.slice(0, 200)}`);
				}
			} else {
				sections.push("## OS Image\n(bootc status unavailable)");
			}

			const ps = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
			if (ps.exitCode === 0) {
				try {
					const containers = JSON.parse(ps.stdout || "[]") as Array<{
						Names?: string[];
						Status?: string;
						State?: string;
					}>;
					if (containers.length === 0) {
						sections.push("## Containers\nNo bloom-* containers running.");
					} else {
						const lines = containers.map((c) => {
							const name = (c.Names ?? []).join(", ") || "unknown";
							return `- ${name}: ${c.Status ?? c.State ?? "unknown"}`;
						});
						sections.push(`## Containers\n${lines.join("\n")}`);
					}
				} catch {
					sections.push("## Containers\n(parse error)");
				}
			}

			const df = await run("df", ["-h", "/", "/var", "/home"], signal);
			if (df.exitCode === 0) {
				sections.push(`## Disk Usage\n\`\`\`\n${df.stdout.trim()}\n\`\`\``);
			}

			const loadavg = await run("cat", ["/proc/loadavg"], signal);
			const meminfo = await run("free", ["-h", "--si"], signal);
			const uptime = await run("uptime", ["-p"], signal);

			const loadParts: string[] = [];
			if (loadavg.exitCode === 0) {
				const parts = loadavg.stdout.trim().split(/\s+/);
				loadParts.push(`Load: ${parts.slice(0, 3).join(" ")}`);
			}
			if (uptime.exitCode === 0) {
				loadParts.push(`Uptime: ${uptime.stdout.trim()}`);
			}
			if (meminfo.exitCode === 0) {
				const memLine = meminfo.stdout.split("\n").find((l) => l.startsWith("Mem:"));
				if (memLine) {
					const cols = memLine.split(/\s+/);
					loadParts.push(`Memory: ${cols[2] ?? "?"} used / ${cols[1] ?? "?"} total`);
				}
			}
			if (loadParts.length > 0) {
				sections.push(`## System\n${loadParts.map((l) => `- ${l}`).join("\n")}`);
			}

			const text = sections.join("\n\n");
			return { content: [{ type: "text", text: truncate(text) }], details: {} };
		},
	});

	// --- Session-start hook: notify about pending updates ---

	let updateChecked = false;

	pi.on("before_agent_start", async (event) => {
		if (updateChecked) return;
		updateChecked = true;
		try {
			const raw = await readFile(statusFile, "utf-8");
			const status = JSON.parse(raw);
			if (status.available && !status.notified) {
				status.notified = true;
				await writeFile(statusFile, JSON.stringify(status), "utf-8");
				const note =
					"\n\n[SYSTEM] A Bloom OS update is available. " +
					"Inform the user and ask if they'd like to review and apply it.";
				return { systemPrompt: event.systemPrompt + note };
			}
		} catch {
			// No status file yet — timer hasn't run
		}
	});
}
