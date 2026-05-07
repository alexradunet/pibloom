import type { InboundMessage } from "./types.js";
import type { Identity } from "./identity.js";

// ── CommandRegistry ──────────────────────────────────────────────────────────
// Extensible slash-command dispatch. Built-in commands register here;
// future apps/protocols can add their own.

export type CommandContext = {
  msg: InboundMessage;
  identity: Identity | null;
  args: string;
};

export type CommandDef = {
  /** Canonical name without slash, e.g. "help". */
  name: string;
  /** Aliases, e.g. ["?"]. */
  aliases?: string[];
  /** One-line help text. */
  helpText: string;
  /** If true, only identities with admin scope can run this. */
  adminOnly?: boolean;
  /** Handler. Returns the reply text, or null if not handled. */
  handler(ctx: CommandContext): string | null;
};

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDef>();
  private readonly aliasToName = new Map<string, string>();

  register(def: CommandDef): void {
    this.commands.set(def.name, def);
    for (const alias of def.aliases ?? []) {
      this.aliasToName.set(alias, def.name);
    }
  }

  /** Resolve a raw input (with or without leading /) to a CommandDef + args. */
  resolve(input: string): { def: CommandDef; args: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;
    const body = trimmed.slice(1).trimStart();
    if (!body) return null;

    const space = body.indexOf(" ");
    const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
    const args = space === -1 ? "" : body.slice(space + 1);

    const def = this.commands.get(name) ?? this.commands.get(this.aliasToName.get(name) ?? "");
    if (!def) return null;
    return { def, args };
  }

  /** Build a help string listing all commands. */
  helpText(channel: string): string {
    const lines: string[] = [`You can chat with Pi here through ${channel}.`, "", "Commands:"];
    for (const def of this.commands.values()) {
      const aliases = def.aliases?.length ? ` (${def.aliases.join(", ")})` : "";
      lines.push(`  /${def.name}${aliases} — ${def.helpText}`);
    }
    return lines.join("\n");
  }

  /** List all registered command names (for protocol discovery). */
  listNames(): string[] {
    return [...this.commands.keys()].sort();
  }
}
