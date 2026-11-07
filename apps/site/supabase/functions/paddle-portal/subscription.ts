/** One of a user's rows of `subscriptions`, as the portal reads it. */
export type Row = {
  status: string;
  paddle_customer_id: string;
  paddle_subscription_id: string;
  paddle_updated_at: string;
};

const running = (status: string) => ["active", "trialing", "past_due"].includes(status);

/**
 * The subscription whose customer the portal signs in as: of the user's subscriptions Paddle
 * bills (a row filed by hand has no `ctm_…` customer), a running one first, then the newest.
 */
export function portalSubscription(rows: readonly Row[]): Row | undefined {
  return rows
    .filter((row) => row.paddle_customer_id.startsWith("ctm_"))
    .sort(
      (a, b) =>
        Number(running(b.status)) - Number(running(a.status)) ||
        Date.parse(b.paddle_updated_at) - Date.parse(a.paddle_updated_at),
    )[0];
}
