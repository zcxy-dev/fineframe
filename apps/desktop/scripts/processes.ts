// Which running processes an app started, from a listing of every process.

/** One process: its id, its parent's, and when it started, where the listing says. */
export interface ProcessRow {
  pid: number;
  parent: number;
  created?: number;
}

/** The processes `root` started, and theirs, by their ids: a process in a group of its own is
 * still its parent's child. Windows reuses ids, so a process can name as its parent an id that a
 * process started after it now has; where the listing says when each started, a child counts only
 * when it started no earlier than its parent. */
export function descendantsOf(rows: readonly ProcessRow[], root: number): number[] {
  const children = new Map<number, ProcessRow[]>();
  const created = new Map(rows.map((row) => [row.pid, row.created]));
  for (const row of rows) children.set(row.parent, [...(children.get(row.parent) ?? []), row]);
  // Each id is followed once, so a loop of reused ids ends.
  const found = new Set<number>();
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    const since = created.get(parent);
    for (const { pid: child, created: born } of children.get(parent) ?? []) {
      if (since !== undefined && born !== undefined && born < since) continue;
      if (child === root || found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return [...found];
}

/** Of the processes `started`, those running in the listing `now`. Windows reuses ids, so where
 * the listings say when each started, a process with the same id counts only when it started at
 * the same time. */
export function stillRunning(
  started: readonly ProcessRow[],
  now: readonly ProcessRow[],
): ProcessRow[] {
  const running = new Map(now.map((row) => [row.pid, row.created]));
  return started.filter(
    (row) =>
      running.has(row.pid) &&
      (row.created === undefined ||
        running.get(row.pid) === undefined ||
        running.get(row.pid) === row.created),
  );
}
