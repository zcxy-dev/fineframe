// Runs once as the server starts.

/**
 * In the desktop app (VIDEO_EDITOR_STOP_WITH_STDIN=1), the app holds the server's stdin open:
 * when the app ends, even force-quit, the pipe closes and the server exits, stopping a running
 * edit and the analysis's setup as it does.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VIDEO_EDITOR_STOP_WITH_STDIN !== "1") {
    return;
  }
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.resume();
}
