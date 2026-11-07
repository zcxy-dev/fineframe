-- The rules of `public.subscriptions`, `public.paddle_subscriptions_seen` and
-- `apply_paddle_subscription` (migrations/20261022022240_subscriptions.sql,
-- 20261106043000_paddle_subscription_seen.sql, 20261107100000_subscription_per_row.sql). Run with
-- `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- Synthetic users; the first two each with a live yearly subscription.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'one@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'two@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'three@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'four@example.test');
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
  'a user reads only their own rows'
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
    where paddle_subscription_id = 'sub_01aaaaaaaaaaaaaaaaaaaaaaaa'),
  row('past_due', '2027-11-01T00:00:00Z'::timestamptz)::text,
  'a newer event of the same subscription applies, keeping the last period end'
);

select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'canceled', 'yearly', '2026-11-01T12:00:00Z', null,
  'sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-01T12:00:00Z'
);
select is(
  (select row(status, paddle_updated_at)::text from public.subscriptions
    where paddle_subscription_id = 'sub_01aaaaaaaaaaaaaaaaaaaaaaaa'),
  row('past_due', '2026-11-02T00:00:00Z'::timestamptz)::text,
  'an event older than the row''s paddle_updated_at is ignored'
);

-- The first user has a second, ended subscription: it gets its own row and leaves the live one
-- as it is, even newer.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'canceled', 'monthly', '2026-11-03T00:00:00Z', null,
  'sub_01cccccccccccccccccccccccc', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-03T00:00:00Z'
);
select results_eq(
  $$ select paddle_subscription_id, status from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000001' order by 1 $$,
  $$ values ('sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'past_due'), ('sub_01cccccccccccccccccccccccc', 'canceled') $$,
  'an ended subscription gets its own row beside a live one'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'paused', 'monthly', '2026-12-03T00:00:00Z', null,
  'sub_01cccccccccccccccccccccccc', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-04T00:00:00Z'
);
select is(
  (select status from public.subscriptions
    where paddle_subscription_id = 'sub_01aaaaaaaaaaaaaaaaaaaaaaaa'),
  'past_due',
  'a paused subscription leaves the live one as it is'
);

-- A new subscription gets its own row beside an ended one.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000002', 'canceled', 'yearly', '2026-11-05T00:00:00Z', null,
  'sub_01bbbbbbbbbbbbbbbbbbbbbbbb', 'ctm_01bbbbbbbbbbbbbbbbbbbbbbbb', '2026-11-05T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000002', 'active', 'monthly', '2026-12-06T00:00:00Z', null,
  'sub_01dddddddddddddddddddddddd', 'ctm_01bbbbbbbbbbbbbbbbbbbbbbbb', '2026-11-06T00:00:00Z'
);
select is(
  (select row(status, plan, current_period_end)::text
    from public.subscriptions where paddle_subscription_id = 'sub_01dddddddddddddddddddddddd'),
  row('active', 'monthly', '2026-12-06T00:00:00Z'::timestamptz)::text,
  'a new subscription gets its own row beside an ended one'
);

-- A late event of a subscription that later ended is stale: it does not bring the ended
-- subscription back.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000002', 'canceled', 'monthly', '2026-12-06T00:00:00Z', null,
  'sub_01dddddddddddddddddddddddd', 'ctm_01bbbbbbbbbbbbbbbbbbbbbbbb', '2026-11-07T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000002', 'active', 'yearly', '2027-11-01T00:00:00Z', null,
  'sub_01bbbbbbbbbbbbbbbbbbbbbbbb', 'ctm_01bbbbbbbbbbbbbbbbbbbbbbbb', '2026-11-04T00:00:00Z'
);
select results_eq(
  $$ select paddle_subscription_id, status from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000002' order by 1 $$,
  $$ values ('sub_01bbbbbbbbbbbbbbbbbbbbbbbb', 'canceled'), ('sub_01dddddddddddddddddddddddd', 'canceled') $$,
  'an event older than one already seen for its subscription is ignored'
);

-- A new subscription's first event applies even when Paddle sends it after another
-- subscription's later update.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000003', 'canceled', 'monthly', '2026-11-03T00:00:00Z', null,
  'sub_01eeeeeeeeeeeeeeeeeeeeeeee', 'ctm_01eeeeeeeeeeeeeeeeeeeeeeee', '2026-11-03T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000003', 'active', 'yearly', '2027-11-02T00:00:00Z', null,
  'sub_01ffffffffffffffffffffffff', 'ctm_01eeeeeeeeeeeeeeeeeeeeeeee', '2026-11-02T00:00:00Z'
);
select is(
  (select status from public.subscriptions
    where paddle_subscription_id = 'sub_01ffffffffffffffffffffffff'),
  'active',
  'a live subscription seen for the first time applies beside a newer ended one'
);

-- An event of a subscription is stale once a newer one of it was seen, whatever happened to the
-- user's other subscriptions since.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'canceled', 'yearly', '2027-11-01T00:00:00Z', null,
  'sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-08T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000001', 'active', 'monthly', '2026-12-02T00:00:00Z', null,
  'sub_01cccccccccccccccccccccccc', 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-02T00:00:00Z'
);
select results_eq(
  $$ select paddle_subscription_id, status from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000001' order by 1 $$,
  $$ values ('sub_01aaaaaaaaaaaaaaaaaaaaaaaa', 'canceled'), ('sub_01cccccccccccccccccccccccc', 'paused') $$,
  'an event older than one seen for its subscription is ignored beside another subscription'
);

-- A user with two subscriptions stays entitled by the live one when the other ends (#321): the
-- paused one, then a new active one, then the paused one resumed and canceled.
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000004', 'paused', 'monthly', '2026-12-01T00:00:00Z', null,
  'sub_01gggggggggggggggggggggggg', 'ctm_01gggggggggggggggggggggggg', '2026-11-01T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000004', 'active', 'yearly', '2027-11-02T00:00:00Z', null,
  'sub_01hhhhhhhhhhhhhhhhhhhhhhhh', 'ctm_01gggggggggggggggggggggggg', '2026-11-02T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000004', 'active', 'monthly', '2026-12-03T00:00:00Z', null,
  'sub_01gggggggggggggggggggggggg', 'ctm_01gggggggggggggggggggggggg', '2026-11-03T00:00:00Z'
);
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000004', 'canceled', 'monthly', '2026-11-04T00:00:00Z', null,
  'sub_01gggggggggggggggggggggggg', 'ctm_01gggggggggggggggggggggggg', '2026-11-04T00:00:00Z'
);
select ok(
  (select bool_or(status in ('active', 'trialing', 'past_due')) from public.subscriptions
    where user_id = '00000000-0000-4000-8000-000000000004'),
  'a live subscription keeps its user entitled when their other one ends'
);

-- A subscription seen before without a row of its own (one the earlier one-row-per-user table
-- replaced): a late event of it stays out.
insert into public.paddle_subscriptions_seen values
  ('sub_01iiiiiiiiiiiiiiiiiiiiiiii', '00000000-0000-4000-8000-000000000004', '2026-11-05T00:00:00Z');
select public.apply_paddle_subscription(
  '00000000-0000-4000-8000-000000000004', 'active', 'monthly', '2026-12-03T00:00:00Z', null,
  'sub_01iiiiiiiiiiiiiiiiiiiiiiii', 'ctm_01gggggggggggggggggggggggg', '2026-11-03T00:00:00Z'
);
select is_empty(
  $$ select 1 from public.subscriptions where paddle_subscription_id = 'sub_01iiiiiiiiiiiiiiiiiiiiiiii' $$,
  'an event older than one seen for a subscription without a row is ignored'
);
reset role;

-- Each of a user's subscriptions is theirs to read.
set local role authenticated;
select set_config(
  'request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}', true
);
select results_eq(
  $$ select paddle_subscription_id, status from public.subscriptions order by 1 $$,
  $$ values ('sub_01gggggggggggggggggggggggg', 'canceled'), ('sub_01hhhhhhhhhhhhhhhhhhhhhhhh', 'active') $$,
  'a user reads every one of their subscriptions'
);
reset role;

-- What the webhook has seen stays the service role's.
set local role authenticated;
select throws_ok($$ select * from public.paddle_subscriptions_seen $$, '42501',
  'permission denied for table paddle_subscriptions_seen', 'authenticated cannot read what the webhook has seen');
reset role;
set local role anon;
select throws_ok($$ select * from public.paddle_subscriptions_seen $$, '42501',
  'permission denied for table paddle_subscriptions_seen', 'anon cannot read what the webhook has seen');
reset role;

select * from finish();
rollback;
