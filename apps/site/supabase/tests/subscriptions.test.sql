-- The rules of `public.subscriptions` and `apply_paddle_subscription`
-- (migrations/20261022022240_subscriptions.sql). Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Two synthetic users, each with a live yearly subscription.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'one@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'two@example.test');
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'active', 'yearly', '2027-11-01T00:00:00Z', null,
  'sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-01T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000002', 'active', 'yearly', '2027-11-01T00:00:00Z', null,
  'sub_01bbbbbbbbbbbbbbbbbbbbbbbb', 'ctm_01bbbbbbbbbbbbbbbbbbbbbbbb', '2026-11-01T00:00:00Z'
);

-- Signed out.
set local role anon;
select throws_ok(
  $$ insert into public.subscriptions values (
    '00000000-0000-4000-8000-000000000001', 'active', 'yearly', null, null, 'sub_x', 'ctm_x', now()
  ) $$,
  '42501', 'permission denied for table subscriptions', 'anon cannot insert'
);
select throws_ok($$ update public.subscriptions set status = 'active' $$, '42501', null,
  'anon cannot update');
select throws_ok($$ delete from public.subscriptions $$, '42501', null, 'anon cannot delete');
select throws_ok($$ truncate public.subscriptions $$, '42501', null, 'anon cannot truncate');
select throws_ok($$ select * from public.subscriptions $$, '42501', null, 'anon cannot read');
select throws_ok(
  $$ select public.apply_paddle_subscription(
    '00000000-0000-4000-8000-000000000001', 'active', 'monthly', null, null,
    'sub_x', 'ctm_x', now()
  ) $$,
  '42501', 'permission denied for function apply_paddle_subscription',
  'anon cannot execute apply_paddle_subscription'
);
reset role;

-- Signed in as the first user.
set local role authenticated;
select set_config(
  'request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true
);
select results_eq(
  $$ select user_id from public.subscriptions $$,
  $$ values ('00000000-0000-4000-8000-000000000001'::uuid) $$,
  'a user reads only their own row'
);
select throws_ok(
  $$ insert into public.subscriptions values (
    '00000000-0000-4000-8000-000000000001', 'active', 'yearly', null, null, 'sub_x', 'ctm_x', now()
  ) $$,
  '42501', 'permission denied for table subscriptions', 'authenticated cannot insert'
);
select throws_ok($$ update public.subscriptions set status = 'active' $$, '42501', null,
  'authenticated cannot update');
select throws_ok($$ delete from public.subscriptions $$, '42501', null,
  'authenticated cannot delete');
select throws_ok($$ truncate public.subscriptions $$, '42501', null,
  'authenticated cannot truncate');
select throws_ok(
  $$ select public.apply_paddle_subscription(
    '00000000-0000-4000-8000-000000000001', 'active', 'monthly', null, null,
    'sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', now()
  ) $$,
  '42501', 'permission denied for function apply_paddle_subscription',
  'authenticated cannot execute apply_paddle_subscription'
);
reset role;

-- The webhook's writes, as the service role.
set local role service_role;
select lives_ok(
  $$ select public.apply_paddle_subscription(
    '00000000-0000-4000-8000-000000000001', 'past_due', 'yearly', null, null,
    'sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-02T00:00:00Z'
  ) $$,
  'the service role executes apply_paddle_subscription'
);
select is(
  (select row(status, current_period_end)::text from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000001'),
  row('past_due', '2027-11-01T00:00:00Z'::timestamptz)::text,
  'a newer event of the same subscription applies, keeping the last period end'
);

select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'canceled', 'yearly', '2026-11-01T12:00:00Z', null,
  'sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-01T12:00:00Z'
);
select is(
  (select row(status, paddle_updated_at)::text from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000001'),
  row('past_due', '2026-11-02T00:00:00Z'::timestamptz)::text,
  'an event older than the row''s paddle_updated_at is ignored'
);

-- The first user has a second, ended subscription: it does not replace the live one, even newer.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'canceled', 'monthly', '2026-11-03T00:00:00Z', null,
  'sub_01cccccccccccccccccccccccc', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-03T00:00:00Z'
);
select is(
  (select row(paddle_subscription_id, status)::text from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000001'),
  row('sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'past_due')::text,
  'an ended subscription does not replace a live one'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'paused', 'monthly', '2026-12-03T00:00:00Z', null,
  'sub_01cccccccccccccccccccccccc', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-04T00:00:00Z'
);
select is(
  (select paddle_subscription_id from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000001'),
  'sub_01aaaaaaaaaaaaaaaaaaaaaaaa',
  'a paused subscription does not replace a live one'
);

-- A live subscription replaces an ended one.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000002', 'canceled', 'yearly', '2026-11-05T00:00:00Z', null,
  'sub_01bbbbbbbbbbbbbbbbbbbbbbbb', 'ctm_01bbbbbbbbbbbbbbbbbbbbbbbb', '2026-11-05T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000002', 'active', 'monthly', '2026-12-06T00:00:00Z', null,
  'sub_01dddddddddddddddddddddddd', 'ctm_01bbbbbbbbbbbbbbbbbbbbbbbb', '2026-11-06T00:00:00Z'
);
select is(
  (select row(paddle_subscription_id, status, plan, current_period_end)::text
    from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000002'),
  row('sub_01dddddddddddddddddddddddd', 'active', 'monthly', '2026-12-06T00:00:00Z'::timestamptz)::text,
  'a live subscription replaces an ended one'
);
reset role;

select * from finish();
rollback;
