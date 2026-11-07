import assert from "node:assert/strict";
import { test } from "node:test";
import { entitled, paddleBilled, type Row, shown } from "./subscription.ts";

const now = new Date("2026-11-07T00:00:00Z");

const row = (
  status: string,
  paddle_updated_at: string,
  current_period_end: string | null = null,
  paddle_customer_id = "ctm_01aaaaaaaaaaaaaaaaaaaaaaaa",
): Row => ({ status, current_period_end, paddle_customer_id, paddle_updated_at });

const active = row("active", "2026-11-02T00:00:00Z");
const ended = row("canceled", "2026-11-04T00:00:00Z", "2026-11-04T00:00:00Z");
const leaving = row("canceled", "2026-11-05T00:00:00Z", "2026-12-01T00:00:00Z");
const paused = row("paused", "2026-11-06T00:00:00Z");
const comp = row("active", "2026-11-06T00:00:00Z", null, "comp");

test("of a user's subscriptions, the one shown entitles them when any does", () => {
  // The case of #321: the newer event ended one subscription while another still runs.
  assert.equal(shown([ended, active], now), active);
  assert.equal(shown([leaving, paused, active], now), active);
  assert.equal(shown([paused, leaving], now), leaving);
  assert.equal(shown([ended, paused], now), paused);
  assert.equal(shown([], now), null);
  for (const rows of [[ended], [ended, paused], [ended, active], [leaving, ended], [comp, ended]]) {
    assert.equal(
      entitled(shown(rows, now), now),
      rows.some((r) => entitled(r, now)),
    );
  }
});

test("a subscription Paddle charges for is shown before a newer one filed by hand", () => {
  assert.equal(shown([comp, active], now), active);
  assert.equal(shown([comp, ended], now), comp);
});

test("the portal opens on the subscription the account page shows, when Paddle bills it", () => {
  const portal = (rows: Row[]) => shown(rows.filter(paddleBilled), now);
  for (const rows of [
    [ended, active],
    [paused, leaving],
    [comp, active],
    [ended, paused],
  ]) {
    assert.equal(portal(rows), shown(rows, now));
  }
  assert.equal(portal([comp, ended]), ended);
  assert.equal(portal([comp]), null);
});
