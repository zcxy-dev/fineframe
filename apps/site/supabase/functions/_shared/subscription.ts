// ENTITLEMENT.md's rule over a user's rows of `subscriptions`, and which row speaks for the user,
// for the site and the paddle-portal Edge Function alike. It imports nothing, so Node and Deno
// both load it.

/** What these rules read of a row of `subscriptions`. */
export type Row = {
  status: string;
  current_period_end: string | null;
  paddle_customer_id: string;
  paddle_updated_at: string;
};

/** The rule in ENTITLEMENT.md: whether the subscription lets its user use the app. */
export function entitled(row: Row | null, now = new Date()): boolean {
  if (!row) return false;
  if (row.status === "active" || row.status === "trialing" || row.status === "past_due") {
    return true;
  }
  return (
    row.status === "canceled" &&
    row.current_period_end !== null &&
    new Date(row.current_period_end) > now
  );
}

/** Whether Paddle bills the subscription, so its customer portal can manage it. */
export function paddleBilled(row: Row): boolean {
  // Paddle's customer ids are `ctm_…`; a row filed by hand has none.
  return row.paddle_customer_id.startsWith("ctm_");
}

/**
 * Of a user's subscriptions, the one that speaks for them: a running one before one cancelled
 * with time left, either before one that does not entitle; among equals, one Paddle bills, then
 * the newest. So it entitles the user exactly when any of them does, and a subscription Paddle
 * still charges for is never hidden behind one filed by hand.
 */
export function shown<T extends Row>(rows: readonly T[], now = new Date()): T | null {
  const rank = (row: T) => (entitled(row, now) ? (row.status === "canceled" ? 1 : 2) : 0);
  return (
    [...rows].sort(
      (a, b) =>
        rank(b) - rank(a) ||
        Number(paddleBilled(b)) - Number(paddleBilled(a)) ||
        Date.parse(b.paddle_updated_at) - Date.parse(a.paddle_updated_at),
    )[0] ?? null
  );
}
