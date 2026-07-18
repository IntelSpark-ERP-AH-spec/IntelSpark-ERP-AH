create table if not exists public.organizations (
  id text primary key,
  name text not null,
  realtime_topic text not null unique,
  created_at text not null default (current_timestamp::text),
  updated_at text not null default (current_timestamp::text)
);

insert into public.organizations (id, name, realtime_topic)
values (
  'org_default',
  'IntelSpark ERP-AH',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

alter table public.users add column if not exists organization_id text;
update public.users set organization_id = 'org_default' where organization_id is null or organization_id = '';
alter table public.users alter column organization_id set default 'org_default';
alter table public.users alter column organization_id set not null;

alter table public.produits add column if not exists organization_id text;
update public.produits set organization_id = 'org_default' where organization_id is null or organization_id = '';
alter table public.produits alter column organization_id set default 'org_default';
alter table public.produits alter column organization_id set not null;

alter table public.stock_mouvements add column if not exists organization_id text;
update public.stock_mouvements sm
set organization_id = coalesce(p.organization_id, 'org_default')
from public.produits p
where p.id = sm.produit_id and (sm.organization_id is null or sm.organization_id = '');
update public.stock_mouvements set organization_id = 'org_default' where organization_id is null or organization_id = '';
alter table public.stock_mouvements alter column organization_id set default 'org_default';
alter table public.stock_mouvements alter column organization_id set not null;

do $$ begin
  alter table public.users add constraint users_organization_id_fkey foreign key (organization_id) references public.organizations(id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.produits add constraint produits_organization_id_fkey foreign key (organization_id) references public.organizations(id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.stock_mouvements add constraint stock_mouvements_organization_id_fkey foreign key (organization_id) references public.organizations(id);
exception when duplicate_object then null; end $$;

drop index if exists public.uq_produits_reference_;
create unique index if not exists uq_produits_organization_reference
  on public.produits (organization_id, reference);
create index if not exists idx_produits_organization_active
  on public.produits (organization_id, actif, designation);
create index if not exists idx_stock_mouvements_organization_date
  on public.stock_mouvements (organization_id, created_at desc);

create table if not exists public.organization_documents (
  organization_id text not null references public.organizations(id) on delete cascade,
  key text not null,
  value_json text not null,
  updated_by bigint references public.users(id) on delete set null,
  version bigint not null default 1,
  updated_at text not null default (current_timestamp::text),
  primary key (organization_id, key)
);

create index if not exists idx_organization_documents_updated
  on public.organization_documents (organization_id, updated_at desc);

create table if not exists public.company_settings (
  organization_id text primary key references public.organizations(id) on delete cascade,
  company_name text not null default '',
  company_address text not null default '',
  company_phone text not null default '',
  company_email text not null default '',
  legal_mentions text not null default '',
  logo_url text,
  brands_json text not null default '[]',
  updated_by bigint references public.users(id) on delete set null,
  updated_at text not null default (current_timestamp::text)
);

insert into public.company_settings (organization_id)
values ('org_default')
on conflict (organization_id) do nothing;

insert into public.organization_documents (organization_id, key, value_json, updated_by, version, updated_at)
select 'org_default', d.key, d.value_json, d.user_id, 1, d.updated_at
from public.user_documents d
join public.users u on u.id = d.user_id
where u.role = 'admin'
  and d.key not in (
    'ui_session_state', 'user_preferences', 'is_theme', 'is_lang', 'is_currency',
    'is_font_size', 'is_font_family', 'is_font_color', 'is_active_page'
  )
on conflict (organization_id, key) do update
set value_json = excluded.value_json,
    updated_by = excluded.updated_by,
    version = public.organization_documents.version + 1,
    updated_at = excluded.updated_at;

update public.company_settings s
set company_name = coalesce((select value_json::jsonb #>> '{}' from public.organization_documents where organization_id = s.organization_id and key = 'is_company_name'), s.company_name),
    company_address = coalesce((select value_json::jsonb #>> '{}' from public.organization_documents where organization_id = s.organization_id and key = 'is_company_address'), s.company_address),
    company_phone = coalesce((select value_json::jsonb #>> '{}' from public.organization_documents where organization_id = s.organization_id and key = 'is_company_phone'), s.company_phone),
    company_email = coalesce((select value_json::jsonb #>> '{}' from public.organization_documents where organization_id = s.organization_id and key = 'is_company_email'), s.company_email),
    legal_mentions = coalesce((select value_json::jsonb #>> '{}' from public.organization_documents where organization_id = s.organization_id and key = 'is_footer'), s.legal_mentions),
    logo_url = coalesce((select value_json::jsonb #>> '{}' from public.organization_documents where organization_id = s.organization_id and key = 'is_logo'), s.logo_url),
    brands_json = coalesce((select value_json from public.organization_documents where organization_id = s.organization_id and key = 'is_brands'), s.brands_json),
    updated_at = current_timestamp::text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-assets',
  'company-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.intelspark_broadcast_org_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_organization text;
  target_topic text;
begin
  if tg_op = 'DELETE' then
    target_organization := old.organization_id;
  else
    target_organization := new.organization_id;
  end if;

  select realtime_topic into target_topic
  from public.organizations
  where id = target_organization;

  if target_topic is not null then
    perform realtime.send(
      jsonb_build_object(
        'entity', tg_table_name,
        'operation', tg_op,
        'changed_at', clock_timestamp()
      ),
      'change',
      'org:' || target_topic,
      false
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.intelspark_broadcast_org_change() from public, anon, authenticated;

drop trigger if exists trg_organization_documents_realtime on public.organization_documents;
create trigger trg_organization_documents_realtime
after insert or update or delete on public.organization_documents
for each row execute function public.intelspark_broadcast_org_change();

drop trigger if exists trg_company_settings_realtime on public.company_settings;
create trigger trg_company_settings_realtime
after insert or update or delete on public.company_settings
for each row execute function public.intelspark_broadcast_org_change();

drop trigger if exists trg_produits_realtime on public.produits;
create trigger trg_produits_realtime
after insert or update or delete on public.produits
for each row execute function public.intelspark_broadcast_org_change();

drop trigger if exists trg_stock_mouvements_realtime on public.stock_mouvements;
create trigger trg_stock_mouvements_realtime
after insert or update or delete on public.stock_mouvements
for each row execute function public.intelspark_broadcast_org_change();

alter table public.organizations enable row level security;
alter table public.organization_documents enable row level security;
alter table public.company_settings enable row level security;
alter table public.users enable row level security;
alter table public.user_documents enable row level security;
alter table public.produits enable row level security;
alter table public.stock_mouvements enable row level security;

revoke all on public.organizations from anon, authenticated;
revoke all on public.organization_documents from anon, authenticated;
revoke all on public.company_settings from anon, authenticated;
revoke all on public.users from anon, authenticated;
revoke all on public.user_documents from anon, authenticated;
revoke all on public.produits from anon, authenticated;
revoke all on public.stock_mouvements from anon, authenticated;
