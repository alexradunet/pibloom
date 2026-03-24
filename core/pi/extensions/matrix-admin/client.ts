import * as fs from "node:fs";
import * as path from "node:path";
import { applyTransformations } from "./commands.js";

export interface MatrixAdminClientOptions {
  homeserver: string;
  accessToken: string;
  botUserId: string;
  configPath: string;
  fetch?: typeof globalThis.fetch;
}

interface AdminConfig {
  adminRoomId?: string;
}

interface SyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, {
      timeline?: {
        events?: Array<{
          type: string;
          sender: string;
          content: { body: string };
        }>;
      };
    }>;
  };
}

export interface RunCommandResult {
  ok: boolean;
  response?: string;
  error?: string;
}

export interface RunCommandOptions {
  command: string;
  body?: string;
  awaitResponse?: boolean;
  timeoutMs?: number;
}

/** Simple async mutex to serialise concurrent runCommand calls. */
class AsyncMutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this._locked) {
      this._locked = true;
      return () => this._release();
    }
    return new Promise<() => void>((resolve) => {
      this._queue.push(() => {
        this._locked = true;
        resolve(() => this._release());
      });
    });
  }

  private _release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._locked = false;
    }
  }
}

export class MatrixAdminClient {
  private readonly homeserver: string;
  private readonly accessToken: string;
  private readonly serverName: string;
  readonly botUserId: string;        // @pi:nixpi — caller identity
  private readonly _serverBotId: string;  // @conduit:nixpi — server bot that replies
  private readonly configPath: string;
  readonly _fetch: typeof globalThis.fetch;
  private readonly _mutex = new AsyncMutex();
  private _cachedRoomId: string | undefined;

  constructor(options: MatrixAdminClientOptions) {
    this.homeserver = options.homeserver.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.serverName = options.botUserId.split(":")[1] ?? "nixpi";
    this.botUserId = options.botUserId;
    this._serverBotId = `@conduit:${this.serverName}`;
    this.configPath = options.configPath;
    this._fetch = options.fetch ?? globalThis.fetch;
    this._loadCachedRoomId();
  }

  private _loadCachedRoomId(): void {
    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      const config = JSON.parse(raw) as AdminConfig;
      this._cachedRoomId = config.adminRoomId;
    } catch {
      // file doesn't exist or is malformed — will discover on first use
    }
  }

  private _saveCachedRoomId(roomId: string): void {
    const config: AdminConfig = { adminRoomId: roomId };
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf8");
    this._cachedRoomId = roomId;
  }

  async invalidateRoomCache(): Promise<void> {
    this._cachedRoomId = undefined;
    try {
      fs.unlinkSync(this.configPath);
    } catch {
      // file may not exist
    }
  }

  async getAdminRoomId(): Promise<string> {
    if (this._cachedRoomId) return this._cachedRoomId;

    const alias = `#admins:${this.serverName}`;
    const encodedAlias = encodeURIComponent(alias);
    const url = `${this.homeserver}/_matrix/client/v3/directory/room/${encodedAlias}`;

    const resp = await this._fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!resp.ok) {
      throw new Error("admin room not found");
    }

    const data = (await resp.json()) as { room_id: string };
    this._saveCachedRoomId(data.room_id);
    return data.room_id;
  }

  async getSinceToken(roomId: string): Promise<string> {
    const filter = encodeURIComponent(
      JSON.stringify({
        room: { rooms: [roomId], timeline: { limit: 1 } },
        presence: { not_types: ["*"] },
        account_data: { not_types: ["*"] },
      }),
    );
    const url = `${this.homeserver}/_matrix/client/v3/sync?timeout=0&filter=${filter}`;
    const resp = await this._fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!resp.ok) throw new Error(`sync failed: ${resp.status}`);
    const data = (await resp.json()) as { next_batch: string };
    return data.next_batch;
  }

  async sendAdminCommand(
    roomId: string,
    command: string,
    body: string | undefined,
  ): Promise<void> {
    let text = `!admin ${command}`;
    if (body) {
      text = `${text}\n\`\`\`\n${body}\n\`\`\``;
    }

    const txnId = `matrix-admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const encodedRoomId = encodeURIComponent(roomId);
    const url = `${this.homeserver}/_matrix/client/v3/rooms/${encodedRoomId}/send/m.room.message/${txnId}`;

    const resp = await this._fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", body: text }),
    });

    if (!resp.ok) throw new Error(`send failed: ${resp.status}`);
  }

  async pollForResponse(
    roomId: string,
    since: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const filter = encodeURIComponent(
      JSON.stringify({
        room: { rooms: [roomId], timeline: { limit: 50 } },
        presence: { not_types: ["*"] },
        account_data: { not_types: ["*"] },
      }),
    );

    const deadline = Date.now() + timeoutMs;
    let currentSince = since;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const syncTimeout = Math.min(remaining, 15000);

      const url = `${this.homeserver}/_matrix/client/v3/sync?since=${currentSince}&timeout=${syncTimeout}&filter=${filter}`;
      const resp = await this._fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!resp.ok) throw new Error(`sync error: ${resp.status}`);

      const data = (await resp.json()) as SyncResponse;
      const roomData = data.rooms?.join?.[roomId];
      if (roomData?.timeline?.events) {
        for (const event of roomData.timeline.events) {
          if (event.type === "m.room.message" && event.sender === this._serverBotId) {
            return event.content.body;
          }
        }
      }

      currentSince = data.next_batch;
    }

    return null;
  }

  async runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
    const { body, awaitResponse = true, timeoutMs = 15000 } = options;
    const command = applyTransformations(options.command);

    const release = await this._mutex.acquire();
    try {
      if (!awaitResponse) {
        const roomId = await this.getAdminRoomId();
        await this.sendAdminCommand(roomId, command, body);
        return { ok: true };
      }

      let roomId = await this.getAdminRoomId();

      // Capture since token before sending (timeout clock starts at mutex acquisition)
      let since = "";
      try {
        since = await this.getSinceToken(roomId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }

      // Send — retry once with room re-discovery on 403/404
      try {
        await this.sendAdminCommand(roomId, command, body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("404")) {
          await this.invalidateRoomCache();
          try {
            roomId = await this.getAdminRoomId();
          } catch {
            return { ok: false, error: "admin room not found" };
          }
          try {
            since = await this.getSinceToken(roomId);
            await this.sendAdminCommand(roomId, command, body);
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            return { ok: false, error: retryMsg };
          }
        } else {
          return { ok: false, error: msg };
        }
      }

      // Poll for response
      try {
        const response = await this.pollForResponse(roomId, since, timeoutMs);
        if (response === null) return { ok: false, error: "timeout" };
        return { ok: true, response };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    } finally {
      release();
    }
  }
}
