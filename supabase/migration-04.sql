-- Atualização 04: lixeira, quem pagou, dúvidas ligadas à receita e
-- dica de embalagem que sabe para qual total foi escrita.
-- Pode ser rodado mais de uma vez sem estragar nada.

create table if not exists an_trash (
  id uuid primary key,
  tbl text not null default '',
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  deleted_by text not null default '',
  deleted_at timestamptz not null default now()
);

alter table an_ingredients add column if not exists bought_by text not null default '';
alter table an_ingredients add column if not exists hint_qty numeric;
alter table an_extras add column if not exists bought_by text not null default '';
alter table an_pendencias add column if not exists recipe_id uuid references an_recipes(id) on delete cascade;

alter table an_trash enable row level security;
revoke all on an_trash from anon;
grant select, insert, update, delete on an_trash to authenticated;
drop policy if exists "grupo logado" on an_trash;
create policy "grupo logado" on an_trash for all to authenticated using (true) with check (true);
do $$
begin
  alter publication supabase_realtime add table an_trash;
exception when duplicate_object then null;
end $$;
