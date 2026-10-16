import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

test("the desktop app's server exits once the app holding its stdin is gone", async () => {
  const script = `import { register } from ${JSON.stringify(new URL("./instrumentation.ts", import.meta.url).href)};
process.on("exit", () => console.log("stopping edits"));
register();
console.log("ready");
setInterval(() => {}, 1000);`;
  const server = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, NEXT_RUNTIME: "nodejs", VIDEO_EDITOR_STOP_WITH_STDIN: "1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let out = "";
  server.stdout.on("data", (chunk) => {
    out += chunk;
  });
  while (!out.includes("ready")) await new Promise((done) => setTimeout(done, 20));
  server.stdin.end();
  const [code] = await once(server, "exit");
  assert.equal(code, 0);
  assert.match(out, /stopping edits/);
});
