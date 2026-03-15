/**
 * Manifest apply handler for bloom-services.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { getQuadletDir } from "../../lib/filesystem.js";
import { writeServiceHomeRuntime } from "../../lib/service-home.js";
import { loadServiceCatalog } from "../../lib/services-catalog.js";
import { loadManifest, saveManifest } from "../../lib/services-manifest.js";
import { errorResult, requireConfirmation, truncate } from "../../lib/shared.js";
import { ensureServiceInstalled } from "./actions-install.js";

type ApplyCounters = {
	installedCount: number;
	startedCount: number;
	stoppedCount: number;
	enabledCount: number;
	disabledCount: number;
	manifestChanged: boolean;
	needsReload: boolean;
};

function createApplyCounters(): ApplyCounters {
	return {
		installedCount: 0,
		startedCount: 0,
		stoppedCount: 0,
		enabledCount: 0,
		disabledCount: 0,
		manifestChanged: false,
		needsReload: false,
	};
}

async function ensureManifestApplyConfirmed(dryRun: boolean, serviceCount: number, ctx: ExtensionContext) {
	if (dryRun) return null;
	const denied = await requireConfirmation(ctx, `Apply manifest to ${serviceCount} service(s)`);
	return denied ? errorResult(denied) : null;
}

async function installMissingServices(params: {
	serviceEntries: Array<[string, { enabled: boolean; version?: string; image?: string }]>;
	installMissing: boolean;
	dryRun: boolean;
	catalog: ReturnType<typeof loadServiceCatalog>;
	bloomDir: string;
	manifestPath: string;
	repoDir: string;
	systemdDir: string;
	manifest: ReturnType<typeof loadManifest>;
	signal: AbortSignal | undefined;
	lines: string[];
	errors: string[];
	counters: ApplyCounters;
}) {
	for (const [name, svc] of params.serviceEntries) {
		if (!svc.enabled) continue;
		const unit = `bloom-${name}`;
		const containerDef = join(params.systemdDir, `${unit}.container`);
		if (existsSync(containerDef)) continue;
		await installMissingService({ ...params, name, svc, containerDef });
	}
}

async function installMissingService(params: {
	name: string;
	svc: { enabled: boolean; version?: string; image?: string };
	installMissing: boolean;
	dryRun: boolean;
	catalog: ReturnType<typeof loadServiceCatalog>;
	bloomDir: string;
	manifestPath: string;
	repoDir: string;
	containerDef: string;
	manifest: ReturnType<typeof loadManifest>;
	signal: AbortSignal | undefined;
	lines: string[];
	errors: string[];
	counters: ApplyCounters;
}) {
	if (!params.installMissing) {
		params.errors.push(
			`${params.name}: missing unit ${params.containerDef} (set install_missing=true to auto-install)`,
		);
		return;
	}

	const version = params.svc.version?.trim() || params.catalog[params.name]?.version || "latest";
	if (params.dryRun) {
		params.lines.push(`[dry-run] install ${params.name}@${version}`);
		params.counters.installedCount += 1;
		return;
	}

	const installResult = await ensureServiceInstalled(
		params.name,
		params.catalog,
		params.bloomDir,
		params.manifestPath,
		params.repoDir,
		params.signal,
	);
	if (!installResult.ok) {
		params.errors.push(`${params.name}: install failed — ${installResult.note}`);
		return;
	}

	params.counters.installedCount += 1;
	params.counters.needsReload = true;
	params.lines.push(`Installed ${params.name} from bundled local package`);
	updateManifestInstallMetadata(
		params.manifest,
		params.name,
		params.svc,
		version,
		installResult.catalogEntry,
		params.counters,
	);
}

function updateManifestInstallMetadata(
	manifest: ReturnType<typeof loadManifest>,
	name: string,
	svc: { version?: string; image?: string },
	version: string,
	catalogEntry: ReturnType<typeof loadServiceCatalog>[string] | undefined,
	counters: ApplyCounters,
) {
	if (!svc.version) {
		manifest.services[name].version = version;
		counters.manifestChanged = true;
	}
	if ((!svc.image || svc.image === "unknown") && catalogEntry?.image) {
		manifest.services[name].image = catalogEntry.image;
		counters.manifestChanged = true;
	}
}

async function maybeReloadSystemd(needsReload: boolean, dryRun: boolean, signal: AbortSignal | undefined) {
	if (!needsReload || dryRun) return null;
	const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
	return reload.exitCode === 0
		? null
		: errorResult(`manifest_apply: daemon-reload failed:\n${reload.stderr || reload.stdout}`);
}

async function reconcileServiceStates(params: {
	serviceEntries: Array<[string, { enabled: boolean }]>;
	systemdDir: string;
	userSystemdDir: string;
	dryRun: boolean;
	signal: AbortSignal | undefined;
	lines: string[];
	errors: string[];
	counters: ApplyCounters;
}) {
	for (const [name, svc] of params.serviceEntries) {
		const unit = `bloom-${name}`;
		const containerDef = join(params.systemdDir, `${unit}.container`);
		const socketDef = join(params.userSystemdDir, `${unit}.socket`);
		const startTarget = existsSync(socketDef) ? `${unit}.socket` : `${unit}.service`;
		if (svc.enabled) {
			await startManifestService({ ...params, name, unit, containerDef, startTarget });
			continue;
		}
		await stopManifestService({ ...params, unit });
	}
}

async function startManifestService(params: {
	name: string;
	containerDef: string;
	startTarget: string;
	dryRun: boolean;
	signal: AbortSignal | undefined;
	lines: string[];
	errors: string[];
	counters: ApplyCounters;
}) {
	if (!existsSync(params.containerDef)) {
		params.errors.push(`${params.name}: cannot start, unit not installed`);
		return;
	}
	if (params.dryRun) {
		params.lines.push(`[dry-run] enable/start ${params.startTarget}`);
		params.counters.startedCount += 1;
		params.counters.enabledCount += 1;
		return;
	}

	const enableResult = await run("systemctl", ["--user", "enable", "--now", params.startTarget], params.signal);
	const startResult =
		enableResult.exitCode === 0
			? enableResult
			: await run("systemctl", ["--user", "start", params.startTarget], params.signal);
	if (startResult.exitCode !== 0) {
		params.errors.push(
			`${params.name}: failed to start ${params.startTarget}: ${
				startResult.stderr || startResult.stdout || enableResult.stderr || enableResult.stdout
			}`,
		);
		return;
	}

	params.counters.startedCount += 1;
	if (enableResult.exitCode === 0) {
		params.counters.enabledCount += 1;
		params.lines.push(`Enabled and started ${params.startTarget}`);
		return;
	}
	params.lines.push(
		`Started ${params.startTarget} (enable skipped: ${enableResult.stderr || enableResult.stdout || "not supported"})`,
	);
}

async function stopManifestService(params: {
	unit: string;
	dryRun: boolean;
	signal: AbortSignal | undefined;
	lines: string[];
	counters: ApplyCounters;
}) {
	if (params.dryRun) {
		params.lines.push(`[dry-run] disable/stop ${params.unit}.socket (if present)`);
		params.lines.push(`[dry-run] disable/stop ${params.unit}.service`);
		params.counters.stoppedCount += 1;
		params.counters.disabledCount += 1;
		return;
	}

	const disableSocket = await run("systemctl", ["--user", "disable", "--now", `${params.unit}.socket`], params.signal);
	const disableService = await run(
		"systemctl",
		["--user", "disable", "--now", `${params.unit}.service`],
		params.signal,
	);
	if (disableSocket.exitCode !== 0) {
		await run("systemctl", ["--user", "stop", `${params.unit}.socket`], params.signal);
	}
	if (disableService.exitCode !== 0) {
		await run("systemctl", ["--user", "stop", `${params.unit}.service`], params.signal);
	}
	params.counters.stoppedCount += 1;
	if (disableSocket.exitCode === 0 || disableService.exitCode === 0) {
		params.counters.disabledCount += 1;
		params.lines.push(`Disabled and stopped ${params.unit}`);
		return;
	}
	params.lines.push(`Stopped ${params.unit}`);
}

export async function handleManifestApply(
	params: {
		install_missing?: boolean;
		dry_run?: boolean;
	},
	bloomDir: string,
	manifestPath: string,
	repoDir: string,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const manifest = loadManifest(manifestPath);
	const serviceEntries = Object.entries(manifest.services).sort(([a], [b]) => a.localeCompare(b));
	if (serviceEntries.length === 0) {
		return errorResult("Manifest has no services. Use manifest_set_service first.");
	}

	const installMissing = params.install_missing ?? true;
	const dryRun = params.dry_run ?? false;
	const confirmError = await ensureManifestApplyConfirmed(dryRun, serviceEntries.length, ctx);
	if (confirmError) return confirmError;

	const catalog = loadServiceCatalog(repoDir);
	const lines: string[] = [];
	const errors: string[] = [];
	const counters = createApplyCounters();

	const systemdDir = getQuadletDir();
	const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");
	await installMissingServices({
		serviceEntries,
		installMissing,
		dryRun,
		catalog,
		bloomDir,
		manifestPath,
		repoDir,
		systemdDir,
		manifest,
		signal,
		lines,
		errors,
		counters,
	});

	const reloadError = await maybeReloadSystemd(counters.needsReload, dryRun, signal);
	if (reloadError) return reloadError;

	await reconcileServiceStates({
		serviceEntries,
		systemdDir,
		userSystemdDir,
		dryRun,
		signal,
		lines,
		errors,
		counters,
	});

	if (counters.manifestChanged && !dryRun) {
		saveManifest(manifest, manifestPath);
	}

	if (!dryRun) {
		await writeServiceHomeRuntime(join(os.homedir(), ".config", "bloom"), repoDir, signal);
	}

	const summary = [
		`Manifest apply complete (${dryRun ? "dry-run" : "live"}).`,
		`Installed: ${counters.installedCount}`,
		`Started: ${counters.startedCount}`,
		`Enabled persistently: ${counters.enabledCount}`,
		`Stopped: ${counters.stoppedCount}`,
		`Disabled persistently: ${counters.disabledCount}`,
		`Errors: ${errors.length}`,
		"",
		...(lines.length > 0 ? ["Actions:", ...lines, ""] : []),
		...(errors.length > 0 ? ["Errors:", ...errors] : []),
	].join("\n");

	return {
		content: [{ type: "text" as const, text: truncate(summary) }],
		details: {
			installed: counters.installedCount,
			started: counters.startedCount,
			enabled: counters.enabledCount,
			stopped: counters.stoppedCount,
			disabled: counters.disabledCount,
			errors,
			dryRun,
		},
		isError: errors.length > 0,
	};
}
