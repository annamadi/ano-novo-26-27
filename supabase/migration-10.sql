-- Atualização 10: grupo do ingrediente dentro da receita e lista particular de cada pessoa.
-- Pode ser rodado mais de uma vez sem estragar nada.

-- Grupo escolhido à mão (Principais, Acompanhamentos, Extras, Temperos, Molhos e condimentos, Outros).
-- Vazio = o site decide pelo nome do ingrediente.
alter table an_recipe_items add column if not exists kind text not null default '';

-- Lista particular: cada pessoa só lê e altera as próprias linhas.
create table if not exists an_private (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  item text not null default '',
  done boolean not null default false,
  pos double precision not null default 0
);
alter table an_private enable row level security;
revoke all on an_private from anon;
grant select, insert, update, delete on an_private to authenticated;
drop policy if exists "so a dona" on an_private;
create policy "so a dona" on an_private for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
do $$ begin
  alter publication supabase_realtime add table an_private;
exception when duplicate_object then null;
end $$;
