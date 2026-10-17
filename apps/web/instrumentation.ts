// Runs once as the server starts. What it does needs Node, so it is loaded only there.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./lib/parent.ts")).stopWithParent();
}
