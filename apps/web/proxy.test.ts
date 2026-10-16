import assert from "node:assert/strict";
import { test } from "node:test";
import { proxy } from "./proxy.ts";

const get = (host: string, origin?: string) =>
  proxy(
    new Request("http://127.0.0.1:3000/api/jobs/latest", {
      headers: { host, ...(origin ? { origin } : {}) },
    }),
  );

test("a page whose name resolves to this machine cannot read it (DNS rebinding)", () => {
  // Origin matches Host, so only the name itself gives the other site away.
  assert.equal(get("evil.example:3000", "http://evil.example:3000")?.status, 403);
  assert.equal(get("evil.example:3000")?.status, 403);
  assert.equal(get("")?.status, 403);
});

test("the page itself, at this machine's own names, gets through", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
    assert.equal(get(host, `http://${host}`), undefined, host);
  }
  for (const [given, host] of [
    ["100.64.0.1", "100.64.0.1:3000"],
    ["fd7a::1", "[fd7a::1]:3000"],
    ["MyBox.example", "mybox.example:3000"],
  ] as const) {
    process.env.VIDEO_EDITOR_HOST = given;
    assert.equal(get(host), undefined, `the address it was given, ${given}`);
  }
  delete process.env.VIDEO_EDITOR_HOST;
});

test("names allowed for a proxy in front, such as tailscale serve, get through", () => {
  process.env.VIDEO_EDITOR_ALLOWED_HOSTS = "box.tail1.ts.net, Other.example";
  assert.equal(get("box.tail1.ts.net:3317"), undefined);
  assert.equal(get("other.example"), undefined);
  assert.equal(get("evil.example:3317")?.status, 403);
  delete process.env.VIDEO_EDITOR_ALLOWED_HOSTS;
});
