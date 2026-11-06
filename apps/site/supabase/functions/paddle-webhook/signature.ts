// The webhook's check of Paddle's signature. Plain TypeScript, without Deno or npm imports, so
// `node --test` runs its tests.

/** How old a signed event may be, against replays. */
const MAX_AGE_S = 300;

/**
 * Checks `Paddle-Signature: ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<body>">` against
 * `secret` at `nowMs` (milliseconds since the epoch).
 */
export async function signed(
  header: string,
  body: string,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  const parts = Object.fromEntries(header.split(";").map((part) => part.split("=", 2)));
  const ts = Number(parts.ts);
  if (!secret || !parts.h1 || !(Math.abs(nowMs / 1000 - ts) <= MAX_AGE_S)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const mac = new Uint8Array(
    parts.h1.match(/../g)?.map((byte: string) => parseInt(byte, 16)) ?? [],
  );
  // `verify` compares in constant time.
  return crypto.subtle.verify("HMAC", key, mac, new TextEncoder().encode(`${parts.ts}:${body}`));
}
