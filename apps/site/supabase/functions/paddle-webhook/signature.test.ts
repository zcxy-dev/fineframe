import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { signed } from "./signature.ts";

const SECRET = "pdl_ntfset_synthetic_secret";
const BODY = '{"event_type":"subscription.updated","data":{"id":"sub_01aaaaaaaaaaaaaaaaaaaaaaaa"}}';
const TS = 1_793_491_200;
const NOW_MS = TS * 1000;

/** The header Paddle sends for `body` signed with `secret` at `ts`. */
function header(body: string, secret: string, ts: number) {
  const h1 = createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

test("a body signed with the secret within 300 s passes", async () => {
  assert.equal(await signed(header(BODY, SECRET, TS), BODY, SECRET, NOW_MS), true);
  assert.equal(await signed(header(BODY, SECRET, TS), BODY, SECRET, NOW_MS + 300_000), true);
});

test("a signature made with another secret fails", async () => {
  assert.equal(await signed(header(BODY, "another secret", TS), BODY, SECRET, NOW_MS), false);
});

test("a changed body fails", async () => {
  assert.equal(await signed(header(BODY, SECRET, TS), `${BODY} `, SECRET, NOW_MS), false);
});

test("a timestamp more than 300 s away fails", async () => {
  assert.equal(await signed(header(BODY, SECRET, TS), BODY, SECRET, NOW_MS + 301_000), false);
  assert.equal(await signed(header(BODY, SECRET, TS), BODY, SECRET, NOW_MS - 301_000), false);
});

test("several h1, as during a secret rotation, pass when any one matches", async () => {
  const valid = header(BODY, SECRET, TS);
  const h1 = valid.split(";h1=")[1] ?? "";
  assert.equal(await signed(`${valid};h1=deadbeef`, BODY, SECRET, NOW_MS), true);
  assert.equal(await signed(`ts=${TS};h1=deadbeef;h1=${h1}`, BODY, SECRET, NOW_MS), true);
  assert.equal(
    await signed(`ts=${TS};h1=deadbeef;h1=${"0".repeat(64)}`, BODY, SECRET, NOW_MS),
    false,
  );
});

test("a missing or malformed h1 fails", async () => {
  const h1 = header(BODY, SECRET, TS).split(";h1=")[1] ?? "";
  for (const bad of [
    `ts=${TS}`,
    `ts=${TS};h1=`,
    `ts=${TS};h1=not-hex`,
    `ts=${TS};h1=${h1.slice(0, -2)}`,
    // The valid digest with an extra character, or with one character that is not hex.
    `ts=${TS};h1=${h1}x`,
    `ts=${TS};h1=${h1}0`,
    `ts=${TS};h1=${h1.slice(0, 1)}z${h1.slice(2)}`,
    `ts=${TS};h1=${h1.slice(0, -1)}z`,
    `ts=${TS};h1=${h1.slice(0, -1)}`,
    "",
  ]) {
    assert.equal(await signed(bad, BODY, SECRET, NOW_MS), false, bad);
  }
});

test("no secret configured fails, even for a body signed with an empty key", async () => {
  assert.equal(await signed(header(BODY, "", TS), BODY, "", NOW_MS), false);
});
