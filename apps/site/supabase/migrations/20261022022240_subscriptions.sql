-- One row per user: their latest Paddle subscription. Only the paddle-webhook Edge Function
-- writes it, with the service role; a signed-in user reads their own row.
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  plan text not null check (plan in ('monthly', 'yearly')),
  -- The end of the period paid for. Paddle drops it once a subscription is cancelled, so the
  -- webhook keeps the last one it saw.
  current_period_end timestamptz,
  -- When a cancellation the user scheduled takes effect; null when none is scheduled.
  cancel_at timestamptz,
  paddle_subscription_id text not null unique,
  paddle_customer_id text not null,
  -- Paddle's `updated_at` of the subscription this row holds, so an older event never
  -- overwrites a newer one.
  paddle_updated_at timestamptz not null
);

alter table public.subscriptions enable row level security;

create policy "Users read their own subscription"
  on public.subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on public.subscriptions from anon, authenticated;
revoke select on public.subscriptions from anon;

-- The webhook's write: the subscription in one Paddle event. It skips an event older than the
-- state the row holds, and an ended subscription never replaces another, live one.
create function public.apply_paddle_subscription(
  p_user_id uuid,
  p_status text,
  p_plan text,
  p_current_period_end timestamptz,
  p_cancel_at timestamptz,
  p_paddle_subscription_id text,
  p_paddle_customer_id text,
  p_paddle_updated_at timestamptz
) returns void
language sql
set search_path = ''
as $$
  insert into public.subscriptions as s (
    user_id, status, plan, current_period_end, cancel_at,
    paddle_subscription_id, paddle_customer_id, paddle_updated_at
  )
  values (
    p_user_id, p_status, p_plan, p_current_period_end, p_cancel_at,
    p_paddle_subscription_id, p_paddle_customer_id, p_paddle_updated_at
  )
  on conflict (user_id) do update set
    status = excluded.status,
    plan = excluded.plan,
    current_period_end = case
      when excluded.paddle_subscription_id = s.paddle_subscription_id
        then coalesce(excluded.current_period_end, s.current_period_end)
      else excluded.current_period_end
    end,
    cancel_at = excluded.cancel_at,
    paddle_subscription_id = excluded.paddle_subscription_id,
    paddle_customer_id = excluded.paddle_customer_id,
    paddle_updated_at = excluded.paddle_updated_at
  where case
    when s.paddle_subscription_id = excluded.paddle_subscription_id
      then s.paddle_updated_at <= excluded.paddle_updated_at
    else excluded.status in ('active', 'trialing', 'past_due')
      or s.status not in ('active', 'trialing', 'past_due')
  end;
$$;

revoke execute on function public.apply_paddle_subscription from public, anon, authenticated;
grant execute on function public.apply_paddle_subscription to service_role;
