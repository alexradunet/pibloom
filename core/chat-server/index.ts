import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiSessionBridge } from "./pi-session.js";

export interface ChatServerOptions {
	/** Working directory for the Pi agent process (e.g. ~/.pi). */
	agentCwd: string;
	/** Directory containing the pre-built frontend (index.html + assets). */
	staticDir: string;
}

type ChatRequestBody = { message?: string };

const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".ico": "image/x-icon",
};

type RouteMatch = "chat" | "reset" | "static" | "method_not_allowed";

function warmSession(piSession: PiSessionBridge): void {
	// Pre-create the in-process Pi SDK session so first request latency stays low.
	piSession.start().catch((err: unknown) => {
		console.error("Failed to start Pi SDK session:", err);
	});
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
	let body = "";
	for await (const chunk of req) {
		body += chunk;
	}
	return body;
}

function parseChatRequest(body: string): { ok: true; message: string } | { ok: false; error: string } {
	let parsed: ChatRequestBody;
	try {
		parsed = JSON.parse(body) as ChatRequestBody;
	} catch {
		return { ok: false, error: "invalid JSON" };
	}

	if (!parsed.message || typeof parsed.message !== "string") {
		return { ok: false, error: "message required" };
	}

	return { ok: true, message: parsed.message };
}

function writeJsonError(res: http.ServerResponse, statusCode: number, error: string): void {
	res.writeHead(statusCode).end(JSON.stringify({ error }));
}

function writeEmpty(res: http.ServerResponse, statusCode: number): void {
	res.writeHead(statusCode).end();
}

function beginEventStream(res: http.ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "application/x-ndjson",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
}

async function streamChatResponse(
	res: http.ServerResponse,
	piSession: PiSessionBridge,
	message: string,
): Promise<void> {
	beginEventStream(res);

	try {
		for await (const event of piSession.sendMessage(message)) {
			res.write(`${JSON.stringify(event)}\n`);
		}
	} catch (err) {
		res.write(`${JSON.stringify({ type: "error", message: String(err) })}\n`);
	}

	res.end();
}

function isSessionResetRequest(req: http.IncomingMessage, url: URL): boolean {
	return req.method === "DELETE" && /^\/chat\/[^/]+$/.test(url.pathname);
}

function matchRoute(req: http.IncomingMessage, url: URL): RouteMatch {
	if (req.method === "POST" && url.pathname === "/chat") {
		return "chat";
	}
	if (isSessionResetRequest(req, url)) {
		return "reset";
	}
	if (req.method === "GET") {
		return "static";
	}
	return "method_not_allowed";
}

function resolveStaticFilePath(staticDir: string, pathname: string): string | null {
	const filePath = path.join(staticDir, pathname === "/" ? "index.html" : pathname);
	const root = staticDir.endsWith(path.sep) ? staticDir : `${staticDir}${path.sep}`;
	return filePath.startsWith(root) ? filePath : null;
}

function serveStaticFile(res: http.ServerResponse, filePath: string): void {
	try {
		const data = fs.readFileSync(filePath);
		const ext = path.extname(filePath);
		res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
		res.end(data);
	} catch {
		res.writeHead(404).end("Not found");
	}
}

async function handleChatRoute(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	piSession: PiSessionBridge,
): Promise<void> {
	const parsed = parseChatRequest(await readRequestBody(req));
	if (!parsed.ok) {
		writeJsonError(res, 400, parsed.error);
		return;
	}

	await streamChatResponse(res, piSession, parsed.message);
}

async function handleResetRoute(res: http.ServerResponse, piSession: PiSessionBridge): Promise<void> {
	await piSession.reset();
	writeEmpty(res, 204);
}

function handleStaticRoute(res: http.ServerResponse, staticDir: string, pathname: string): void {
	const filePath = resolveStaticFilePath(staticDir, pathname);
	if (!filePath) {
		writeEmpty(res, 403);
		return;
	}
	serveStaticFile(res, filePath);
}

function readServerConfig(moduleUrl: string) {
	return {
		port: parseInt(process.env.NIXPI_CHAT_PORT ?? "8080", 10),
		piDir: process.env.PI_DIR ?? `${process.env.HOME}/.pi`,
		staticDir: path.join(path.dirname(fileURLToPath(moduleUrl)), "frontend/dist"),
	};
}

export function createChatServer(opts: ChatServerOptions): http.Server {
	const piSession = new PiSessionBridge({ cwd: opts.agentCwd });
	warmSession(piSession);

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		switch (matchRoute(req, url)) {
			case "chat":
				await handleChatRoute(req, res, piSession);
				return;
			case "reset":
				// Session id in the URL is tolerated for compatibility but ignored.
				await handleResetRoute(res, piSession);
				return;
			case "static":
				handleStaticRoute(res, opts.staticDir, url.pathname);
				return;
			case "method_not_allowed":
				writeEmpty(res, 405);
				return;
		}
	});

	server.on("close", () => {
		piSession.stop().catch(() => {});
	});

	return server;
}

export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
	if (!argv1) {
		return false;
	}

	const modulePath = fileURLToPath(moduleUrl);

	try {
		return fs.realpathSync(argv1) === fs.realpathSync(modulePath);
	} catch {
		return path.resolve(argv1) === path.resolve(modulePath);
	}
}

if (isMainModule(process.argv[1], import.meta.url)) {
	const { port, piDir, staticDir } = readServerConfig(import.meta.url);

	const server = createChatServer({
		agentCwd: piDir,
		staticDir,
	});

	server.listen(port, "127.0.0.1", () => {
		console.log(`nixpi-chat listening on 127.0.0.1:${port}`);
	});
}
