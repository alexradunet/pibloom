import * as fs from "node:fs";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool, registerTools } from "../../../lib/extension-tools.js";
import { getPiDir } from "../../../lib/filesystem.js";
import { matrixCredentialsPath } from "../../../lib/matrix.js";
import type { MatrixCredentials } from "../../../lib/matrix.js";
import { isDangerous } from "./commands.js";
import { MatrixAdminClient } from "./client.js";
import * as path from "node:path";

function matrixAdminConfigPath(): string {
  return path.join(getPiDir(), "matrix-admin.json");
}

function loadClient(): MatrixAdminClient {
  const credsPath = matrixCredentialsPath();
  let creds: MatrixCredentials;
  try {
    creds = JSON.parse(fs.readFileSync(credsPath, "utf8")) as MatrixCredentials;
  } catch (err) {
    throw new Error(
      `matrix-admin: credentials unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return new MatrixAdminClient({
    homeserver: creds.homeserver,
    accessToken: creds.botAccessToken,
    botUserId: creds.botUserId,
    configPath: matrixAdminConfigPath(),
  });
}

export default function (pi: ExtensionAPI) {
  let client: MatrixAdminClient;
  try {
    client = loadClient();
  } catch (err) {
    console.error(`[matrix-admin] Failed to initialise:`, err);
    return;
  }

  registerTools(pi, [
    defineTool({
      name: "matrix_admin",
      label: "Matrix Admin",
      description:
        "Send a Continuwuity admin command to the Matrix admin room and return the server's response. " +
        "Pass the command string without the '!admin' prefix. " +
        "Commands marked dangerous require explicit user confirmation before calling this tool.",
      parameters: Type.Object({
        command: Type.String({
          description:
            "Admin command without the '!admin' prefix. E.g. 'users list-users', 'rooms list-rooms', 'server uptime'.",
        }),
        body: Type.Optional(
          Type.String({
            description:
              "Newline-delimited list for bulk codeblock commands (e.g. deactivate-all, ban-list-of-rooms).",
          }),
        ),
        await_response: Type.Optional(
          Type.Boolean({
            description: "Whether to wait for the server's reply. Defaults to true.",
          }),
        ),
        timeout_ms: Type.Optional(
          Type.Number({
            description: "How long to wait for a reply in milliseconds. Defaults to 15000.",
          }),
        ),
        confirmed: Type.Optional(
          Type.Boolean({
            description:
              "Set to true after the user has explicitly confirmed they want to run this dangerous command. Required for commands marked ⚠️.",
          }),
        ),
      }),
      async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
        const params = rawParams as {
          command: string;
          body?: string;
          await_response?: boolean;
          timeout_ms?: number;
          confirmed?: boolean;
        };

        if (isDangerous(params.command) && !params.confirmed) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Command '${params.command}' is dangerous (destructive or irreversible). ` +
                  `Ask the user to confirm, then re-call this tool with confirmed: true.`,
              },
            ],
            details: { command: params.command },
            isError: true,
          };
        }

        const result = await client.runCommand({
          command: params.command,
          body: params.body,
          awaitResponse: params.await_response,
          timeoutMs: params.timeout_ms,
        });

        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `matrix_admin error: ${result.error}` }],
            details: { command: params.command, error: result.error },
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: result.response ?? "Command sent." }],
          details: { command: params.command, response: result.response },
        };
      },
    }),
  ]);
}
