-- Atualização 11: histórico de alterações (quem mudou o quê e quando).
-- Pode ser rodado mais de uma vez sem estragar nada.
-- Quem grava é o próprio banco, a cada inclusão, alteração ou exclusão. O site só lê.

create table if not exists an_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  who text not null default '',          -- username de quem estava logado; 'sistema' quando veio do SQL Editor
  tbl text not null default '',          -- tabela sem o prefixo an_
  op text not null default '',           -- I = incluiu, U = alterou, D = apagou
  row_id uuid,
  label text not null default '',        -- nome da coisa no momento da alteração
  ctx text not null default '',          -- onde ela fica (receita, dia, pendência, atividade)
  diff jsonb not null default '{}'::jsonb -- U: {campo: [antes, depois]}; I e D: a linha inteira
);

-- O grupo logado só lê. Ninguém inclui, altera ou apaga o histórico pelo site.
alter table an_log enable row level security;
revoke all on an_log from anon, authenticated;
grant select on an_log to authenticated;
drop policy if exists "grupo le" on an_log;
create policy "grupo le" on an_log for select to authenticated using (true);

create or replace function an_log_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; o jsonb; d jsonb;
  t text := substr(tg_table_name, 4);
  lbl text := ''; cx text := ''; em text;
begin
  -- exclusões em cascata (os ingredientes de uma receita apagada, por exemplo) não entram: a linha da receita já conta
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    select jsonb_object_agg(n.key, jsonb_build_array(o -> n.key, n.value)) into d
      from jsonb_each(r) n
      where n.key <> 'pos' and n.value is distinct from (o -> n.key);
    if d is null then return null; end if;   -- nada mudou, ou só a ordem
  else
    d := (r - 'id') - 'pos';
  end if;

  if t = 'recipe_items' then
    select name into lbl from an_ingredients where id = (r ->> 'ingredient_id')::uuid;
    select name into cx from an_recipes where id = (r ->> 'recipe_id')::uuid;
  elsif t = 'menu' then
    select name into lbl from an_recipes where id = (r ->> 'recipe_id')::uuid;
    select date::text into cx from an_days where id = (r ->> 'day_id')::uuid;
  elsif t = 'pendencias' then
    lbl := coalesce(nullif(r ->> 'subject', ''), r ->> 'detail');
    select name into cx from an_recipes where id = (r ->> 'recipe_id')::uuid;
  elsif t = 'comments' then
    lbl := r ->> 'body';
    select coalesce(nullif(subject, ''), detail) into cx from an_pendencias where id = (r ->> 'pend_id')::uuid;
  elsif t = 'extras' then
    lbl := r ->> 'item';
    select name into cx from an_activities where id = (r ->> 'activity_id')::uuid;
    if cx is null then cx := r ->> 'grp'; end if;
  elsif t = 'days' then
    lbl := r ->> 'date';
  else
    lbl := r ->> 'name';
  end if;

  em := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  insert into an_log (who, tbl, op, row_id, label, ctx, diff)
  values (coalesce(nullif(split_part(coalesce(em, ''), '@', 1), ''), 'sistema'), t, left(tg_op, 1), (r ->> 'id')::uuid,
          left(coalesce(lbl, ''), 120), left(coalesce(cx, ''), 120), d);
  return null;
end $$;

-- Lixeira e listas particulares ficam de fora: a lixeira repete a exclusão e a lista particular é só da dona.
do $$
declare t text;
begin
  foreach t in array array['an_ingredients','an_recipes','an_recipe_items','an_days','an_menu','an_pendencias','an_extras','an_people','an_activities','an_comments']
  loop
    execute format('drop trigger if exists an_log_trg on %I', t);
    execute format('create trigger an_log_trg after insert or update or delete on %I for each row execute function an_log_write()', t);
  end loop;
end $$;
