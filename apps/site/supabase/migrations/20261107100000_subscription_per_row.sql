-- One row per subscription instead of one per user: an event of one of a user's subscriptions
-- never touches another, so an ended subscription no longer hides a live one. A user is entitled
-- when any of their rows is (ENTITLEMENT.md). Rows filed by hand stay as they are.
alter table public.subscriptions drop constraint subscriptions_pkey;
alter table public.subscriptions drop constraint subscriptions_paddle_subscription_id_key;
alter table public.subscriptions add primary key (paddle_subscription_id);
create index subscriptions_user_id on public.subscriptions (user_id);

-- The webhook's write: the subscription in one Paddle event, into that subscription's row. It
-- skips an event older than one already seen for the same subscription.
create or replace function public.apply_paddle_subscription(
  p_user_id uuid,
  p_status text,
  p_plan text,
  p_current_period_end timestamptz,
  p_cancel_at timestamptz,
  p_paddle_subscription_id text,
  p_paddle_customer_id text,
  p_paddle_updated_at timestamptz
) returns void
language plpgsql
set search_path = ''
as $$
begin
  -- One statement, so that of two deliveries at once the older waits for the newer and then
  -- finds it seen.
  insert into public.paddle_subscriptions_seen as seen (paddle_subscription_id, user_id, paddle_updated_at)
  values (p_paddle_subscription_id, p_user_id, p_paddle_updated_at)
  on conflict (paddle_subscription_id) do update set paddle_updated_at = excluded.paddle_updated_at
  where seen.paddle_updated_at <= excluded.paddle_updated_at;
  if not found then
    return;
  end if;

  insert into public.subscriptions as s (
    user_id, status, plan, current_period_end, cancel_at,
    paddle_subscription_id, paddle_customer_id, paddle_updated_at
  )
  values (
    p_user_id, p_status, p_plan, p_current_period_end, p_cancel_at,
    p_paddle_subscription_id, p_paddle_customer_id, p_paddle_updated_at
  )
  on conflict (paddle_subscription_id) do update set
    status = excluded.status,
    plan = excluded.plan,
    current_period_end = coalesce(excluded.current_period_end, s.current_period_end),
    cancel_at = excluded.cancel_at,
    paddle_customer_id = excluded.paddle_customer_id,
    paddle_updated_at = excluded.paddle_updated_at
  where s.paddle_updated_at <= excluded.paddle_updated_at;
end;
$$;
