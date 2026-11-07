import assert from "node:assert/strict";
import { test } from "node:test";
import { portalSubscription, type Row } from "./subscription.ts";

const row = (
  id: string,
  status: string,
  updated: string,
  customer = "ctm_01aaaaaaaaaaaaaaaaaaaaaaaa",
): Row => ({
  status,
  paddle_customer_id: customer,
  paddle_subscription_id: id,
  paddle_updated_at: updated,
});

test("the portal opens on the user's running subscription, else their newest", () => {
  const running = row("sub_01running", "active", "2026-11-02T00:00:00Z");
  const ended = row("sub_01ended", "canceled", "2026-11-04T00:00:00Z");
  const paused = row("sub_01paused", "paused", "2026-11-03T00:00:00Z");
  assert.equal(portalSubscription([ended, running, paused]), running);
  assert.equal(portalSubscription([paused, ended]), ended);
  assert.equal(portalSubscription([]), undefined);
});

test("a row filed by hand never opens the portal", () => {
  const comp = row("owner-comp", "active", "2026-11-05T00:00:00Z", "comp");
  const ended = row("sub_01ended", "canceled", "2026-11-04T00:00:00Z");
  assert.equal(portalSubscription([comp, ended]), ended);
  assert.equal(portalSubscription([comp]), undefined);
});
