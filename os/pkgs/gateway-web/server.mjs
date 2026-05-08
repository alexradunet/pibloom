#!/usr/bin/env node
import { createReadStream, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const staticRoot = resolve(process.env.OWNLOOM_GATEWAY_WEB_STATIC_ROOT ?? join(here, "public"));
const host = process.env.OWNLOOM_GATEWAY_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.OWNLOOM_GATEWAY_WEB_PORT ?? "8090");
const target = new URL(process.env.OWNLOOM_GATEWAY_URL ?? "http://127.0.0.1:8081");
const terminalTargetRaw = process.env.OWNLOOM_TERMINAL_URL ?? "";
const terminalTarget = terminalTargetRaw ? new URL(terminalTargetRaw) : null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/v1/")) {
    proxyHttp(req, res, target, "gateway");
    return;
  }
  if (isTerminalPath(req.url)) {
    proxyTerminal(req, res);
    return;
  }
  serveStatic(req.url ?? "/", res);
});

server.on("upgrade", (req, socket, head) => {
  if (isTerminalPath(req.url)) {
    if (!terminalTarget) {
      socket.destroy();
      return;
    }
    proxyUpgrade(req, socket, head, terminalTarget);
    return;
  }
  proxyUpgrade(req, socket, head, target);
});

server.listen(port, host, () => {
  const terminal = terminalTarget ? `, terminal -> ${terminalTarget.href}` : "";
  console.log(`ownloom-gateway-web: http://${host}:${port} -> ${target.href}${terminal}`);
});

function isTerminalPath(url) {
  const pathname = new URL(url ?? "/", "http://localhost").pathname;
  return pathname === "/terminal" || pathname.startsWith("/terminal/");
}

function proxyTerminal(req, res) {
  if (!terminalTarget) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Ownloom terminal is not configured.\n");
    return;
  }
  if (new URL(req.url ?? "/", "http://localhost").pathname === "/terminal") {
    res.writeHead(308, { Location: "/terminal/" });
    res.end();
    return;
  }
  proxyHttp(req, res, terminalTarget, "terminal");
}

function proxyHttp(req, res, upstreamTarget, name) {
  const options = {
    protocol: upstreamTarget.protocol,
    hostname: upstreamTarget.hostname,
    port: upstreamTarget.port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: upstreamTarget.host },
  };
  const upstream = httpRequest(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `${name} proxy failed: ${err.message}` }));
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, upstreamTarget) {
  const targetPort = Number(upstreamTarget.port || (upstreamTarget.protocol === "https:" ? 443 : 80));
  const upstream = netConnect(targetPort, upstreamTarget.hostname, () => {
    const path = req.url || "/";
    const headers = { ...req.headers, host: upstreamTarget.host };
    const lines = [`${req.method} ${path} HTTP/${req.httpVersion}`];
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`);
      else if (value !== undefined) lines.push(`${name}: ${value}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
}

function serveStatic(url, res) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(staticRoot, normalize(relative));
  if (!filePath.startsWith(`${staticRoot}/`) && filePath !== staticRoot) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let stats;
  try {
    stats = statSync(filePath);
    if (!stats.isFile()) throw new Error("not a file");
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    "Content-Length": stats.size,
  });
  createReadStream(filePath).pipe(res);
}
