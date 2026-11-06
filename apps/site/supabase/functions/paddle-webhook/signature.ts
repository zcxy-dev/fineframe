// The webhook's check of Paddle's signature. Plain TypeScript, without Deno or npm imports, so
// `node --test` runs its tests.

/** How old a signed event may be, against replays. */
const MAX_AGE_S = 300;

/**
 * Checks `Paddle-Signature: ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<body>">` against
 * `secret` at `nowMs` (milliseconds since the epoch). During a secret rotation Paddle sends
 * several `h1`; one that matches is enough.
 */
export async function signed(
  header: string,
  body: string,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  const parts = header.split(";").map((part) => part.split("=", 2));
  const ts = parts.find(([name]) => name === "ts")?.[1];
  const h1s = parts.filter(([name]) => name === "h1").map(([, value]) => value ?? "");
  if (!secret || !ts || !(Math.abs(nowMs / 1000 - Number(ts)) <= MAX_AGE_S)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${ts}:${body}`);
  for (const h1 of h1s) {
    // A SHA-256 digest is exactly 64 hex characters; anything else is not a signature.
    if (!/^[0-9a-f]{64}$/i.test(h1)) continue;
    const mac = new Uint8Array(h1.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);
    // `verify` compares in constant time.
    if (await crypto.subtle.verify("HMAC", key, mac, data)) return true;
  }
  return false;
}
