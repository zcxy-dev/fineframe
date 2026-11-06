-- The latest Paddle `updated_at` the webhook has seen for each subscription, whichever
-- subscription the user's row holds now: a late event of a subscription that has since been
-- replaced is still recognised as stale, and never brings it back.
create table public.paddle_subscriptions_seen (
  paddle_subscription_id text primary key,
  paddle_updated_at timestamptz not null
);

alter table public.paddle_subscriptions_seen enable row level security;
revoke all on public.paddle_subscriptions_seen from anon, authenticated;

insert into public.paddle_subscriptions_seen (paddle_subscription_id, paddle_updated_at)
select paddle_subscription_id, paddle_updated_at from public.subscriptions;

-- The webhook's write: the subscription in one Paddle event. It skips an event older than one
-- already seen for the same subscription, and an ended subscription never replaces another,
-- live one.
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
  if exists (
    select 1 from public.paddle_subscriptions_seen
    where paddle_subscription_id = p_paddle_subscription_id
      and paddle_updated_at > p_paddle_updated_at
  ) then
    return;
  end if;

  insert into public.paddle_subscriptions_seen as seen (paddle_subscription_id, paddle_updated_at)
  values (p_paddle_subscription_id, p_paddle_updated_at)
  on conflict (paddle_subscription_id) do update set paddle_updated_at = excluded.paddle_updated_at;

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
end;
$$;

revoke execute on function public.apply_paddle_subscription from public, anon, authenticated;
grant execute on function public.apply_paddle_subscription to service_role;
