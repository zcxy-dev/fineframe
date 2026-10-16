// Runs before every route and page.

/**
 * Refuses a request addressed to any name but this machine's own, the address the server was
 * given and the names allowed for a proxy in front of it: another site resolving its name to
 * 127.0.0.1 (DNS rebinding) sends a Host and an Origin that agree, so only the name gives it away.
 */
export function proxy(request: Request): Response | undefined {
  const host = hostname(request.headers.get("host"));
  const own = [
    "127.0.0.1",
    "localhost",
    "[::1]",
    process.env.VIDEO_EDITOR_HOST,
    ...(process.env.VIDEO_EDITOR_ALLOWED_HOSTS ?? "").split(","),
  ].map((name) => hostname(name?.trim()));
  if (host && own.includes(host)) return undefined;
  return Response.json(
    { error: "Open the page at the address the server printed" },
    { status: 403 },
  );
}

/** A Host header's or an address's name as URL writes it: lowercase, an IPv6 one in brackets. */
function hostname(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  return (URL.parse(`http://${host}`) ?? URL.parse(`http://[${host}]`))?.hostname;
}
