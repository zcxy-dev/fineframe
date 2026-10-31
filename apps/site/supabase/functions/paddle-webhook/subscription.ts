// The webhook's mapping from a Paddle subscription to `apply_paddle_subscription`'s arguments.
// Plain TypeScript, without Deno or npm imports, so `node --test` runs its tests.

export type PaddleSubscription = {
  id: string;
  status: string;
  customer_id: string;
  custom_data: { user_id?: string } | null;
  items: { price: { billing_cycle: { interval: string } | null } }[];
  current_billing_period: { ends_at: string } | null;
  scheduled_change: { action: string; effective_at: string } | null;
  canceled_at: string | null;
  updated_at: string;
};

/** The RPC's arguments, or undefined when the subscription is not one of the site's checkouts. */
export function rpcArgs(sub: PaddleSubscription) {
  const userId = sub.custom_data?.user_id;
  const interval = sub.items[0]?.price.billing_cycle?.interval;
  if (!userId || (interval !== "month" && interval !== "year")) return undefined;
  return {
    p_user_id: userId,
    p_status: sub.status,
    p_plan: interval === "month" ? "monthly" : "yearly",
    // Paddle drops the billing period once a subscription is canceled: access then ends when it
    // was canceled, which is the old period's end only for a cancel scheduled for then.
    p_current_period_end:
      sub.status === "canceled" ? sub.canceled_at : (sub.current_billing_period?.ends_at ?? null),
    p_cancel_at:
      sub.scheduled_change?.action === "cancel" ? sub.scheduled_change.effective_at : null,
    p_paddle_subscription_id: sub.id,
    p_paddle_customer_id: sub.customer_id,
    p_paddle_updated_at: sub.updated_at,
  };
}
