import assert from "node:assert/strict";
import { test } from "node:test";
import { type PaddleSubscription, rpcArgs } from "./subscription.ts";

const PERIOD_END = "2027-11-01T00:00:00Z";

/** A synthetic yearly subscription of the site's checkout, active and renewing. */
const active: PaddleSubscription = {
  id: "sub_01aaaaaaaaaaaaaaaaaaaaaaaa",
  status: "active",
  customer_id: "ctm_01aaaaaaaaaaaaaaaaaaaaaaaa",
  custom_data: { user_id: "00000000-0000-4000-8000-000000000001" },
  items: [{ price: { billing_cycle: { interval: "year" } } }],
  current_billing_period: { ends_at: PERIOD_END },
  scheduled_change: null,
  canceled_at: null,
  updated_at: "2026-11-01T00:00:00Z",
};

test("an active subscription files its billing period's end and no cancellation", () => {
  assert.deepEqual(rpcArgs(active), {
    p_user_id: "00000000-0000-4000-8000-000000000001",
    p_status: "active",
    p_plan: "yearly",
    p_current_period_end: PERIOD_END,
    p_cancel_at: null,
    p_paddle_subscription_id: "sub_01aaaaaaaaaaaaaaaaaaaaaaaa",
    p_paddle_customer_id: "ctm_01aaaaaaaaaaaaaaaaaaaaaaaa",
    p_paddle_updated_at: "2026-11-01T00:00:00Z",
  });
});

test("a cancel scheduled for the period's end keeps the period's end and files when it ends", () => {
  const args = rpcArgs({
    ...active,
    scheduled_change: { action: "cancel", effective_at: PERIOD_END },
  });
  assert.equal(args?.p_status, "active");
  assert.equal(args?.p_current_period_end, PERIOD_END);
  assert.equal(args?.p_cancel_at, PERIOD_END);
});

test("an immediate cancel ends access when it was canceled, not at the old period's end", () => {
  const args = rpcArgs({
    ...active,
    status: "canceled",
    current_billing_period: null,
    canceled_at: "2026-11-02T08:00:00Z",
    updated_at: "2026-11-02T08:00:00Z",
  });
  assert.equal(args?.p_status, "canceled");
  assert.equal(args?.p_current_period_end, "2026-11-02T08:00:00Z");
  assert.equal(args?.p_cancel_at, null);
});

test("a monthly subscription files the monthly plan", () => {
  const args = rpcArgs({ ...active, items: [{ price: { billing_cycle: { interval: "month" } } }] });
  assert.equal(args?.p_plan, "monthly");
});

test("a subscription without the site's user id or a known plan is not filed", () => {
  assert.equal(rpcArgs({ ...active, custom_data: null }), undefined);
  assert.equal(rpcArgs({ ...active, items: [{ price: { billing_cycle: null } }] }), undefined);
  assert.equal(
    rpcArgs({ ...active, items: [{ price: { billing_cycle: { interval: "week" } } }] }),
    undefined,
  );
});
