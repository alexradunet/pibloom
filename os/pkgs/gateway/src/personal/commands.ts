import type { CommandRegistry } from "../core/commands.js";
import type { Store } from "../core/store.js";
import type { ChannelConfig } from "../core/router.js";
import { wikiSearch, wikiShowPage } from "./wiki.js";

// ── Register personal commands ───────────────────────────────────────────────
// Adds the /wiki command to the registry. These commands are "personal"
// ownloom concerns; they are optional and only registered when personal
// features are enabled.

export function registerPersonalCommands(registry: CommandRegistry): void {
  registry.register({
    name: "wiki",
    helpText: "search or show wiki pages",
    handler(ctx) {
      const rest = ctx.args.trim();
      if (!rest) return "Usage: wiki <query>  |  wiki show <title>";
      if (rest.toLowerCase().startsWith("show ")) return wikiShowPage(rest.slice(5).trim());
      return wikiSearch(rest);
    },
  });
}
