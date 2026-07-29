create or replace function public.intelspark_broadcast_org_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization text;
  target_topic text;
  changed_key text;
begin
  if tg_op = 'DELETE' then
    target_organization := old.organization_id;
    changed_key := to_jsonb(old) ->> 'key';
  else
    target_organization := new.organization_id;
    changed_key := to_jsonb(new) ->> 'key';
  end if;

  select realtime_topic into target_topic
  from public.organizations
  where id = target_organization;

  if target_topic is not null then
    perform realtime.send(
      jsonb_strip_nulls(jsonb_build_object(
        'entity', tg_table_name,
        'key', changed_key,
        'operation', tg_op,
        'changed_at', clock_timestamp()
      )),
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
