import assert from "node:assert/strict";
import { test } from "node:test";
import { descendantsOf, stillRunning } from "./processes.ts";

test("the app's descendants are the processes it and theirs started, after them", () => {
  // The app (10) started a server (11), which started FFmpeg (12). Process 20 was started long
  // before the app by a system process whose id, 11, Windows has since given to the server.
  const rows = [
    { pid: 10, parent: 1, created: 1000 },
    { pid: 11, parent: 10, created: 1100 },
    { pid: 12, parent: 11, created: 1200 },
    { pid: 20, parent: 11, created: 500 },
  ];
  assert.deepEqual(descendantsOf(rows, 10).sort(), [11, 12]);
  // A listing without creation times (ps) goes by the parent ids alone.
  const bare = rows.map(({ pid, parent }) => ({ pid, parent }));
  assert.deepEqual(descendantsOf(bare, 10).sort(), [11, 12, 20]);
  // A loop of reused ids ends.
  assert.deepEqual(
    descendantsOf(
      [
        { pid: 11, parent: 12 },
        { pid: 12, parent: 11 },
      ],
      11,
    ),
    [12],
  );
});

test("a process the app started is still running only while its id has the same start", () => {
  // The app started 11 and 12. 12 ended, and Windows gave its id to a system process (TiWorker).
  const started = [
    { pid: 11, parent: 10, created: 1100 },
    { pid: 12, parent: 11, created: 1200 },
  ];
  const now = [
    { pid: 11, parent: 10, created: 1100 },
    { pid: 12, parent: 788, created: 9000 },
  ];
  assert.deepEqual(stillRunning(started, now), [started[0]]);
  // A listing without creation times (ps) goes by the ids alone.
  const bare = (rows: typeof now) => rows.map(({ pid, parent }) => ({ pid, parent }));
  assert.deepEqual(stillRunning(bare(started), bare(now)), bare(started));
});
