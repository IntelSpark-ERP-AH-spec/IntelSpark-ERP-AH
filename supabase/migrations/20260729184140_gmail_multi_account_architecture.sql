create table if not exists public.email_accounts (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id text references public.users(id) on delete cascade,
  account_type text not null check (account_type in ('personal', 'organization', 'shared')),
  email_address text not null,
  encrypted_app_password text not null,
  sender_name text not null default '',
  is_active integer not null default 1 check (is_active in (0, 1)),
  is_default integer not null default 0 check (is_default in (0, 1)),
  smtp_enabled integer not null default 1 check (smtp_enabled in (0, 1)),
  imap_enabled integer not null default 1 check (imap_enabled in (0, 1)),
  mail_connected_at text,
  mail_last_uid integer not null default 0,
  mail_uid_validity text,
  mail_last_sync_at text,
  last_test_status text,
  last_test_at text,
  created_by text references public.users(id) on delete set null,
  updated_by text references public.users(id) on delete set null,
  created_at text not null default (to_char(current_timestamp, 'YYYY-MM-DD HH24:MI:SS')),
  updated_at text not null default (to_char(current_timestamp, 'YYYY-MM-DD HH24:MI:SS')),
  check (
    (account_type = 'personal' and user_id is not null)
    or (account_type in ('organization', 'shared') and user_id is null)
  )
);

create unique index if not exists email_accounts_personal_user_unique
  on public.email_accounts (organization_id, user_id)
  where account_type = 'personal';

create unique index if not exists email_accounts_organization_email_unique
  on public.email_accounts (organization_id, lower(email_address))
  where account_type in ('organization', 'shared');

create index if not exists email_accounts_organization_active
  on public.email_accounts (organization_id, is_active, account_type);

create table if not exists public.email_account_permissions (
  id text primary key,
  email_account_id text not null references public.email_accounts(id) on delete cascade,
  user_id text references public.users(id) on delete cascade,
  role_name text,
  can_send integer not null default 0 check (can_send in (0, 1)),
  can_read integer not null default 0 check (can_read in (0, 1)),
  allowed_document_types text not null default '[]',
  created_at text not null default (to_char(current_timestamp, 'YYYY-MM-DD HH24:MI:SS')),
  updated_at text not null default (to_char(current_timestamp, 'YYYY-MM-DD HH24:MI:SS')),
  check (
    (user_id is not null and role_name is null)
    or (user_id is null and role_name is not null)
  )
);

create unique index if not exists email_permissions_account_user_unique
  on public.email_account_permissions (email_account_id, user_id)
  where user_id is not null;

create unique index if not exists email_permissions_account_role_unique
  on public.email_account_permissions (email_account_id, role_name)
  where role_name is not null;

create index if not exists email_permissions_account_access
  on public.email_account_permissions (email_account_id, can_send, can_read);

create table if not exists public.email_account_preferences (
  user_id text primary key references public.users(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  default_account_id text references public.email_accounts(id) on delete set null,
  updated_at text not null default (to_char(current_timestamp, 'YYYY-MM-DD HH24:MI:SS'))
);

alter table public.email_history
  add column if not exists organization_id text,
  add column if not exists email_account_id text,
  add column if not exists sender_user_id text,
  add column if not exists document_type text,
  add column if not exists document_id text,
  add column if not exists status text not null default 'sent',
  add column if not exists error_code text;

update public.email_history as history
set organization_id = users.organization_id,
    sender_user_id = coalesce(history.sender_user_id, history.user_id)
from public.users as users
where users.id = history.user_id
  and (history.organization_id is null or history.sender_user_id is null);

insert into public.email_accounts (
  id,
  organization_id,
  user_id,
  account_type,
  email_address,
  encrypted_app_password,
  sender_name,
  is_active,
  is_default,
  smtp_enabled,
  imap_enabled,
  mail_connected_at,
  mail_last_uid,
  mail_uid_validity,
  mail_last_sync_at,
  created_by,
  updated_by
)
select
  gen_random_uuid()::text,
  users.organization_id,
  users.id,
  'personal',
  lower(trim(users.smtp_user)),
  users.smtp_pass,
  coalesce(users.full_name, users.username, ''),
  1,
  1,
  1,
  1,
  users.mail_connected_at,
  coalesce(users.mail_last_uid, 0),
  users.mail_uid_validity,
  users.mail_last_sync_at,
  users.id,
  users.id
from public.users as users
where coalesce(trim(users.smtp_user), '') <> ''
  and coalesce(users.smtp_pass, '') <> ''
  and not exists (
    select 1
    from public.email_accounts as accounts
    where accounts.account_type = 'personal'
      and accounts.organization_id = users.organization_id
      and accounts.user_id = users.id
  );

update public.email_history as history
set email_account_id = accounts.id
from public.email_accounts as accounts
where history.email_account_id is null
  and accounts.organization_id = history.organization_id
  and lower(accounts.email_address) = lower(history.account_email)
  and (
    accounts.user_id = history.user_id
    or accounts.user_id is null
  );

create index if not exists email_history_organization_date
  on public.email_history (organization_id, created_at desc);

create index if not exists email_history_account_date
  on public.email_history (email_account_id, created_at desc);

alter table public.email_accounts enable row level security;
alter table public.email_account_permissions enable row level security;
alter table public.email_account_preferences enable row level security;

revoke all on table public.email_accounts from anon, authenticated;
revoke all on table public.email_account_permissions from anon, authenticated;
revoke all on table public.email_account_preferences from anon, authenticated;
