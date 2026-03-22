/**
 * Pure Matrix utility functions.
 * No side effects — all I/O is handled by callers.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import { join } from "node:path";
import { getPiDir } from "./filesystem.js";
import { stringifyFrontmatter } from "./frontmatter.js";

/** Path to stored Matrix credentials. */
export function matrixCredentialsPath(): string {
	return join(getPiDir(), "matrix-credentials.json");
}

/** Generate a secure random password (base64url, 24 bytes = 32 chars). */
export function generatePassword(bytes = 24): string {
	return randomBytes(bytes).toString("base64url");
}

/** Matrix credentials structure stored on disk. */
export interface MatrixCredentials {
	homeserver: string;
	botUserId: string;
	botAccessToken: string;
	botPassword: string;
	userUserId?: string;
	userPassword?: string;
	registrationToken?: string;
}

/** Credentials for one agent-specific Matrix account. */
export interface MatrixAgentCredentials {
	homeserver: string;
	userId: string;
	accessToken: string;
	password: string;
	username: string;
}

/** Path to the per-agent Matrix credentials directory. */
export function matrixAgentCredentialsDir(homeDir = os.homedir()): string {
	return process.env.NIXPI_PI_DIR ? join(getPiDir(), "matrix-agents") : join(homeDir, ".pi", "matrix-agents");
}

/** Path to the per-agent Matrix credentials file. */
export function matrixAgentCredentialsPath(agentId: string, homeDir = os.homedir()): string {
	return join(matrixAgentCredentialsDir(homeDir), `${agentId}.json`);
}

/**
 * Register a new Matrix account via the UIA (User-Interactive Authentication) flow.
 * Uses a registration token to authorize the account creation.
 */
export async function registerMatrixAccount(
	homeserver: string,
	username: string,
	password: string,
	registrationToken?: string,
): Promise<{ ok: true; userId: string; accessToken: string } | { ok: false; error: string }> {
	const url = `${homeserver}/_matrix/client/v3/register`;
	const body = { username, password, inhibit_login: false };
	let auth:
		| { type: "m.login.dummy"; session: string }
		| { type: "m.login.registration_token"; session: string; token: string }
		| undefined;

	for (let attempt = 0; attempt < 4; attempt += 1) {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(auth ? { ...body, auth } : body),
		});
		const responseBody = (await response.json()) as {
			session?: string;
			completed?: string[];
			flows?: Array<{ stages?: string[] }>;
			errcode?: string;
			error?: string;
			user_id?: string;
			access_token?: string;
		};

		if (response.ok && responseBody.user_id && responseBody.access_token) {
			return { ok: true, userId: responseBody.user_id, accessToken: responseBody.access_token };
		}

		if (response.status !== 401) {
			return parseRegistrationError(responseBody, response.status);
		}

		const session = responseBody.session;
		if (!session) return { ok: false, error: "No session ID in 401 response" };

		const nextAuth = pickNextRegistrationAuth(responseBody.completed, responseBody.flows, session, registrationToken);
		if (!nextAuth) {
			return { ok: false, error: "No supported registration auth flow advertised by homeserver" };
		}
		auth = nextAuth;
	}

	return { ok: false, error: "Registration did not complete after multiple UIA attempts" };
}

export interface ProvisionMatrixAgentAccountOptions {
	homeserver: string;
	username: string;
	registrationToken?: string;
	password?: string;
	register?: typeof registerMatrixAccount;
}

/** Register a new Matrix account for an agent and return the credential payload to persist. */
export async function provisionMatrixAgentAccount(
	options: ProvisionMatrixAgentAccountOptions,
): Promise<{ ok: true; credentials: MatrixAgentCredentials } | { ok: false; error: string }> {
	const password = options.password ?? generatePassword();
	const register = options.register ?? registerMatrixAccount;
	const result = await register(options.homeserver, options.username, password, options.registrationToken);
	if (!result.ok) return result;

	return {
		ok: true,
		credentials: {
			homeserver: options.homeserver,
			userId: result.userId,
			accessToken: result.accessToken,
			password,
			username: options.username,
		},
	};
}

export interface GenerateAgentInstructionsMarkdownOptions {
	id: string;
	name: string;
	username: string;
	description: string;
	rolePrompt: string;
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	respondMode?: "host" | "mentioned" | "silent";
}

/** Generate a starter `AGENTS.md` file for a Matrix-backed agent. */
export function generateAgentInstructionsMarkdown(options: GenerateAgentInstructionsMarkdownOptions): string {
	const frontmatter: Record<string, unknown> = {
		id: options.id,
		name: options.name,
		matrix: {
			username: options.username,
			autojoin: true,
		},
		...(options.model ? { model: options.model } : {}),
		...(options.thinking ? { thinking: options.thinking } : {}),
		respond: {
			mode: options.respondMode ?? "mentioned",
			allow_agent_mentions: true,
			max_public_turns_per_root: 2,
			cooldown_ms: 1500,
		},
		description: options.description,
	};

	const body = `# ${options.name}\n\n${options.rolePrompt}\n`;
	return stringifyFrontmatter(frontmatter, body);
}

function parseRegistrationError(err: unknown, status: number): { ok: false; error: string } {
	const e = err as { errcode?: string; error?: string };
	if (e.errcode === "M_USER_IN_USE") return { ok: false, error: "Username is already taken." };
	return { ok: false, error: e.error ?? `Registration failed (${status})` };
}

function pickNextRegistrationAuth(
	completed: string[] | undefined,
	flows: Array<{ stages?: string[] }> | undefined,
	session: string,
	registrationToken?: string,
):
	| { type: "m.login.dummy"; session: string }
	| { type: "m.login.registration_token"; session: string; token: string }
	| undefined {
	const completedStages = new Set(completed ?? []);

	for (const flow of flows ?? []) {
		const stages = flow.stages ?? [];
		for (const stage of stages) {
			if (completedStages.has(stage)) continue;
			if (stage === "m.login.registration_token" && registrationToken) {
				return { type: "m.login.registration_token", session, token: registrationToken };
			}
			if (stage === "m.login.dummy") {
				return { type: "m.login.dummy", session };
			}
		}
	}

	if (!completedStages.has("m.login.registration_token") && registrationToken) {
		return { type: "m.login.registration_token", session, token: registrationToken };
	}
	if (!completedStages.has("m.login.dummy")) {
		return { type: "m.login.dummy", session };
	}

	return undefined;
}
