-- Settings the site and the app read at run time: one row, which anyone can read and only the
-- service role (the dashboard's SQL editor) changes.
create table public.app_config (
  id boolean primary key default true check (id),
  -- While false, Fineframe is a free beta: the site sells nothing and every signed-in user may
  -- use the app (ENTITLEMENT.md).
  billing_enabled boolean not null default false
);

insert into public.app_config default values;

alter table public.app_config enable row level security;

create policy "Anyone reads the app config"
  on public.app_config for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate on public.app_config from anon, authenticated;
