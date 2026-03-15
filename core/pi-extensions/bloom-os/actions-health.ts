/**
 * System health handler for bloom-os.
 */
import { run } from "../../lib/exec.js";
import { truncate } from "../../lib/shared.js";

function parseBootcSection(stdout: string): string {
	try {
		const status = JSON.parse(stdout) as {
			status?: { booted?: { image?: { image?: { image?: string; version?: string } } } };
		};
		const img = status?.status?.booted?.image?.image;
		return `## OS Image\n- Image: ${img?.image ?? "unknown"}\n- Version: ${img?.version ?? "unknown"}`;
	} catch {
		return `## OS Image\n${stdout.slice(0, 200)}`;
	}
}

function bootcSection(result: Awaited<ReturnType<typeof run>>): string {
	return result.exitCode === 0 ? parseBootcSection(result.stdout) : "## OS Image\n(bootc status unavailable)";
}

function containersSection(result: Awaited<ReturnType<typeof run>>): string | null {
	if (result.exitCode !== 0) return null;
	try {
		const containers = JSON.parse(result.stdout || "[]") as Array<{
			Names?: string[];
			Status?: string;
			State?: string;
		}>;
		if (containers.length === 0) return "## Containers\nNo bloom-* containers running.";
		const lines = containers.map((c) => {
			const name = (c.Names ?? []).join(", ") || "unknown";
			return `- ${name}: ${c.Status ?? c.State ?? "unknown"}`;
		});
		return `## Containers\n${lines.join("\n")}`;
	} catch {
		return "## Containers\n(parse error)";
	}
}

function diskSection(result: Awaited<ReturnType<typeof run>>): string | null {
	return result.exitCode === 0 ? `## Disk Usage\n\`\`\`\n${result.stdout.trim()}\n\`\`\`` : null;
}

function systemSection(
	loadavg: Awaited<ReturnType<typeof run>>,
	meminfo: Awaited<ReturnType<typeof run>>,
	uptime: Awaited<ReturnType<typeof run>>,
): string | null {
	const loadParts: string[] = [];
	if (loadavg.exitCode === 0) {
		const parts = loadavg.stdout.trim().split(/\s+/);
		loadParts.push(`Load: ${parts.slice(0, 3).join(" ")}`);
	}
	if (uptime.exitCode === 0) loadParts.push(`Uptime: ${uptime.stdout.trim()}`);
	if (meminfo.exitCode === 0) {
		const memLine = meminfo.stdout.split("\n").find((l) => l.startsWith("Mem:"));
		if (memLine) {
			const cols = memLine.split(/\s+/);
			loadParts.push(`Memory: ${cols[2] ?? "?"} used / ${cols[1] ?? "?"} total`);
		}
	}
	return loadParts.length > 0 ? `## System\n${loadParts.map((l) => `- ${l}`).join("\n")}` : null;
}

export async function handleSystemHealth(signal: AbortSignal | undefined) {
	const [bootc, ps, df, loadavg, meminfo, uptime] = await Promise.all([
		run("bootc", ["status", "--format=json"], signal),
		run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal),
		run("df", ["-h", "/", "/var", "/home"], signal),
		run("cat", ["/proc/loadavg"], signal),
		run("free", ["-h", "--si"], signal),
		run("uptime", ["-p"], signal),
	]);

	const sections: string[] = [];
	sections.push(bootcSection(bootc));
	const containers = containersSection(ps);
	if (containers) sections.push(containers);
	const disk = diskSection(df);
	if (disk) sections.push(disk);
	const system = systemSection(loadavg, meminfo, uptime);
	if (system) sections.push(system);

	const text = sections.join("\n\n");
	return { content: [{ type: "text" as const, text: truncate(text) }], details: {} };
}
