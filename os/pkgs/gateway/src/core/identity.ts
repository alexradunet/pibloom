// ── Identity model ──────────────────────────────────────────────────────────
// First-class identity that replaces per-transport allowlists.
// Every inbound message resolves to an Identity before reaching the Router.

export type Scope = "read" | "write" | "admin";

export type IdentitySource =
  | "whatsapp"   // matched by phone number
  | "websocket"  // matched by bearer token
  | "token";     // matched by API bearer token (future HTTP/REST)

export type Identity = {
  /** Stable human-readable id, e.g. "alex" or "alex/web". */
  id: string;
  /** Display name for logs/UI. */
  displayName: string;
  /** What this identity can do. */
  scopes: Scope[];
  /** Which transport mapping produced this identity. */
  source: IdentitySource;
  /** Raw transport-specific key that matched, e.g. "whatsapp:+40700123456". */
  matchedBy: string;
};

// ── IdentityResolver ────────────────────────────────────────────────────────
// Maps a (channel, senderId) pair to an Identity (or null if unknown).

export type IdentityResolver = {
  resolve(channel: string, senderId: string): Identity | null;
};

// ── SimpleIdentityResolver ───────────────────────────────────────────────────
// Resolves identities from a flat map of transport-prefixed keys → Identity.
// Constructed once at startup from config.

export type IdentityEntry = {
  id: string;
  displayName: string;
  scopes: Scope[];
  /** Transport-prefixed keys, e.g. ["whatsapp:+40700123456", "token:web-abc"]. */
  keys: string[];
};

export class SimpleIdentityResolver implements IdentityResolver {
  private readonly byKey = new Map<string, Identity>();

  constructor(entries: IdentityEntry[]) {
    for (const entry of entries) {
      for (const key of entry.keys) {
        const normalizedKey = key.toLowerCase();
        const source = key.split(":")[0] as IdentitySource;
        this.byKey.set(normalizedKey, {
          id: entry.id,
          displayName: entry.displayName,
          scopes: entry.scopes,
          source,
          matchedBy: key,
        });
      }
    }
  }

  resolve(channel: string, senderId: string): Identity | null {
    // Try exact transport-prefixed match first.
    const prefixed = `${channel}:${senderId}`.toLowerCase();
    const byPrefixed = this.byKey.get(prefixed);
    if (byPrefixed) return byPrefixed;

    // Try bare senderId (for token-based identities).
    const byBare = this.byKey.get(senderId.toLowerCase());
    if (byBare) return byBare;

    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function hasScope(identity: Identity, scope: Scope): boolean {
  return identity.scopes.includes(scope);
}

export function isAdmin(identity: Identity): boolean {
  return hasScope(identity, "admin");
}
