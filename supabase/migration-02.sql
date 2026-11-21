-- Atualização 02: pessoas do grupo, atividades de entretenimento com itens,
-- e marcação "precisa comprar" nos itens para levar.
-- Pode ser rodado mais de uma vez sem estragar nada.

create table if not exists an_people (
  id uuid primary key,
  name text not null default '',
  pos double precision not null default 0
);

create table if not exists an_activities (
  id uuid primary key,
  name text not null default '',
  notes text not null default '',
  pos double precision not null default 0
);

alter table an_extras add column if not exists buy boolean not null default false;
alter table an_extras add column if not exists activity_id uuid references an_activities(id) on delete cascade;

-- Cada gincana era uma linha solta; vira uma atividade que pode ter itens.
insert into an_activities (id, name, notes, pos)
  select id, item, '', pos from an_extras where grp = 'Gincanas'
  on conflict (id) do nothing;
delete from an_extras where grp = 'Gincanas';

do $$
declare t text;
begin
  foreach t in array array['an_people','an_activities']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists "grupo logado" on %I', t);
    execute format('create policy "grupo logado" on %I for all to authenticated using (true) with check (true)', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
