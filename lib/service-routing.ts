/** Orchestration: creates NetBird DNS records for service subdomain routing. */

import { ensureBloomZone, ensureServiceRecord, getLocalMeshIp, loadNetBirdToken } from "./netbird.js";
import { validateServiceName } from "./services-validation.js";
import { createLogger } from "./shared.js";

const log = createLogger("service-routing");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutingResult {
	dns: { ok: boolean; skipped?: boolean; error?: string };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Ensure DNS routing for a service: create `{name}.bloom.mesh` A record.
 *
 * If no NetBird token is available, DNS is skipped (reported as `skipped`).
 * Services are directly reachable on their native port via the mesh IP.
 */
export async function ensureServiceRouting(
	serviceName: string,
	/** Reserved for future per-port access policies. */
	_port: number,
	signal?: AbortSignal,
): Promise<RoutingResult> {
	const guard = validateServiceName(serviceName);
	if (guard) {
		return { dns: { ok: false, error: guard } };
	}

	const token = loadNetBirdToken();
	if (!token) {
		log.info("no NetBird API token — skipping DNS record creation", { serviceName });
		return { dns: { ok: false, skipped: true } };
	}

	const meshIp = await getLocalMeshIp(signal);
	if (!meshIp) {
		return { dns: { ok: false, error: "Could not determine local mesh IP from netbird status" } };
	}

	const zone = await ensureBloomZone(token);
	if (!zone.ok || !zone.zoneId) {
		return { dns: { ok: false, error: zone.error ?? "Failed to ensure bloom.mesh zone" } };
	}

	const record = await ensureServiceRecord(token, zone.zoneId, serviceName, meshIp);
	return { dns: { ok: record.ok, error: record.error } };
}
