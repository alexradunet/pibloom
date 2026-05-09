#!/usr/bin/env node
import { createReadStream, readFileSync, statSync } from "node:fs";
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
const radicaleTarget = new URL(process.env.OWNLOOM_RADICALE_URL ?? "http://127.0.0.1:5232");
const radicaleUser = process.env.OWNLOOM_RADICALE_USER ?? "alex";
const terminalPathPrefix = "/terminal";
const radicalePathPrefix = "/radicale";
const terminalTokenFile = process.env.OWNLOOM_TERMINAL_TOKEN_FILE ?? "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

const staticSecurityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self' http://127.0.0.1:* http://[::1]:* http://localhost:* https://127.0.0.1:* https://[::1]:* https://localhost:* ws://127.0.0.1:* ws://[::1]:* ws://localhost:* wss://127.0.0.1:* wss://[::1]:* wss://localhost:*",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
};

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

const server = createServer((req, res) => {
  if (!isAllowedRequest(req)) {
    sendText(res, 421, "Misdirected request\n");
    return;
  }
  if (new URL(req.url ?? "/", "http://localhost").pathname === "/api/v1/terminal-token") {
    serveTerminalToken(req, res);
    return;
  }
  if (isRadicalePath(req.url)) {
    proxyRadicale(req, res);
    return;
  }
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
  if (!isAllowedRequest(req)) {
    socket.destroy();
    return;
  }
  if (isTerminalPath(req.url)) {
    if (!terminalTarget) {
      socket.destroy();
      return;
    }
    proxyUpgrade(req, socket, head, terminalTarget, stripTerminalPrefix(req.url ?? "/"));
    return;
  }
  proxyUpgrade(req, socket, head, target);
});

server.listen(port, host, () => {
  const terminal = terminalTarget ? `, terminal -> ${terminalTarget.href}` : "";
  console.log(`ownloom-gateway-web: http://${host}:${port} -> ${target.href}, radicale -> ${radicaleTarget.href}${terminal}`);
});

function isAllowedRequest(req) {
  return isAllowedHostHeader(req.headers.host) && isAllowedOriginHeader(req.headers.origin);
}

function isAllowedHostHeader(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return isLoopbackHostname(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

function isAllowedOriginHeader(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.every((item) => isAllowedOriginHeader(item));
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(value) {
  const hostname = String(value ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isTerminalPath(url) {
  const pathname = new URL(url ?? "/", "http://localhost").pathname;
  return pathname === terminalPathPrefix || pathname.startsWith(`${terminalPathPrefix}/`);
}

function isRadicalePath(url) {
  const pathname = new URL(url ?? "/", "http://localhost").pathname;
  return pathname === radicalePathPrefix || pathname.startsWith(`${radicalePathPrefix}/`);
}

function proxyRadicale(req, res) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === radicalePathPrefix) {
    res.writeHead(308, { Location: `${radicalePathPrefix}/`, ...noStoreHeaders });
    res.end();
    return;
  }
  if (pathname === `${radicalePathPrefix}/.web/js/main.js`) {
    serveRadicaleAutologinScript(req, res);
    return;
  }
  proxyHttp(req, res, radicaleTarget, "radicale", {
    path: stripRadicalePrefix(req.url ?? "/"),
    headers: { "x-script-name": radicalePathPrefix },
  });
}

function stripRadicalePrefix(url) {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname === radicalePathPrefix || parsed.pathname === `${radicalePathPrefix}/`) {
    parsed.pathname = "/";
  } else if (parsed.pathname.startsWith(`${radicalePathPrefix}/`)) {
    parsed.pathname = parsed.pathname.slice(radicalePathPrefix.length);
  }
  return `${parsed.pathname}${parsed.search}`;
}

function serveRadicaleAutologinScript(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed\n");
    return;
  }
  const body = `import { LoadingScene } from "./scenes/LoadingScene.js";\nimport { LoginScene } from "./scenes/LoginScene.js";\nimport { push_scene } from "./scenes/scene_manager.js";\n\nnew LoadingScene().hide();\nconst loginScene = new LoginScene();\npush_scene(loginScene);\nloginScene._perform_login(${JSON.stringify(radicaleUser)}, "ownloom");\n`;
  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...noStoreHeaders,
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

function proxyTerminal(req, res) {
  if (!terminalTarget) {
    res.writeHead(503, {
      "Content-Type": "text/plain; charset=utf-8",
      ...noStoreHeaders,
    });
    res.end("Ownloom terminal is not configured.\n");
    return;
  }
  if (new URL(req.url ?? "/", "http://localhost").pathname === terminalPathPrefix) {
    res.writeHead(308, { Location: `${terminalPathPrefix}/`, ...noStoreHeaders });
    res.end();
    return;
  }
  proxyHttp(req, res, terminalTarget, "terminal", {
    path: stripTerminalPrefix(req.url ?? "/"),
    rewriteHeaders: rewriteTerminalHeaders,
  });
}

function stripTerminalPrefix(url) {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname === terminalPathPrefix || parsed.pathname === `${terminalPathPrefix}/`) {
    parsed.pathname = "/";
  } else if (parsed.pathname.startsWith(`${terminalPathPrefix}/`)) {
    parsed.pathname = parsed.pathname.slice(terminalPathPrefix.length);
  }
  return `${parsed.pathname}${parsed.search}`;
}

function rewriteTerminalHeaders(headers) {
  return {
    ...headers,
    "x-frame-options": "SAMEORIGIN",
  };
}

function serveTerminalToken(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }
  if (!isLoopbackRemote(req.socket.remoteAddress)) {
    sendJson(res, 403, { error: "terminal token is loopback-only" });
    return;
  }
  if (!terminalTokenFile) {
    sendJson(res, 404, { error: "terminal token file is not configured" });
    return;
  }

  let raw;
  try {
    raw = readFileSync(terminalTokenFile, "utf8");
  } catch {
    sendJson(res, 404, { error: "terminal token is not available yet" });
    return;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const token = lines[lines.length - 1];
  if (!token) {
    sendJson(res, 404, { error: "terminal token file does not contain a token" });
    return;
  }
  sendJson(res, 200, { token });
}

function isLoopbackRemote(remoteAddress) {
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...noStoreHeaders,
  });
  res.end(JSON.stringify(body));
}

function proxyHttp(req, res, upstreamTarget, name, proxyOptions = {}) {
  const options = {
    protocol: upstreamTarget.protocol,
    hostname: upstreamTarget.hostname,
    port: upstreamTarget.port,
    method: req.method,
    path: proxyOptions.path ?? req.url,
    headers: { ...req.headers, ...(proxyOptions.headers ?? {}), host: upstreamTarget.host },
  };
  const upstream = httpRequest(options, (upstreamRes) => {
    const rewrittenHeaders = proxyOptions.rewriteHeaders
      ? proxyOptions.rewriteHeaders(upstreamRes.headers)
      : upstreamRes.headers;
    res.writeHead(upstreamRes.statusCode ?? 502, withNoStore(rewrittenHeaders));
    upstreamRes.pipe(res);
  });
  upstream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...noStoreHeaders,
    });
    res.end(JSON.stringify({ error: `${name} proxy failed: ${err.message}` }));
  });
  req.pipe(upstream);
}

function withNoStore(headers) {
  const next = { ...headers };
  delete next["cache-control"];
  delete next["Cache-Control"];
  delete next.pragma;
  delete next.Pragma;
  delete next.expires;
  delete next.Expires;
  return {
    ...next,
    ...noStoreHeaders,
  };
}

function proxyUpgrade(req, socket, head, upstreamTarget, upstreamPath = req.url || "/") {
  const targetPort = Number(upstreamTarget.port || (upstreamTarget.protocol === "https:" ? 443 : 80));
  const upstream = netConnect(targetPort, upstreamTarget.hostname, () => {
    const path = upstreamPath;
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
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    sendText(res, 400, "Bad request\n");
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(staticRoot, normalize(relative));
  if (!filePath.startsWith(`${staticRoot}/`) && filePath !== staticRoot) {
    sendText(res, 403, "Forbidden\n");
    return;
  }

  let stats;
  try {
    stats = statSync(filePath);
    if (!stats.isFile()) throw new Error("not a file");
  } catch {
    sendText(res, 404, "Not found\n");
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": "no-cache, max-age=0",
    ...staticSecurityHeaders,
  });
  createReadStream(filePath).pipe(res);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache, max-age=0",
    ...staticSecurityHeaders,
  });
  res.end(body);
}
