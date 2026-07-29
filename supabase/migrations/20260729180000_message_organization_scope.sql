alter table public.messages
  add column if not exists organization_id text;

update public.messages as messages
set organization_id = coalesce(users.organization_id, 'org_default')
from public.users as users
where users.id = messages.sender_id
  and (messages.organization_id is null or messages.organization_id = '');

update public.messages
set organization_id = 'org_default'
where organization_id is null or organization_id = '';

alter table public.messages
  alter column organization_id set default 'org_default',
  alter column organization_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_organization_id_fkey'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_organization_id_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete cascade;
  end if;
end
$$;

create index if not exists idx_messages_organization_created
  on public.messages (organization_id, created_at desc);
