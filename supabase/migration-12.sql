-- Atualização 12: compras por pessoa (quem comprou ou separou, quanto e quanto pagou).
-- Pode ser rodado mais de uma vez sem estragar nada.
-- Um item pode ter várias linhas: "Fulana, 1 garrafa, R$ 60" e "Beltrana, 1 garrafa, R$ 0".
-- qty vazio = tudo. Com linhas, o item está resolvido quando alguma é "tudo" ou a soma cobre o total das receitas.

create table if not exists an_buys (
  id uuid primary key,
  ingredient_id uuid references an_ingredients(id) on delete cascade,
  extra_id uuid references an_extras(id) on delete cascade,
  who text not null default '',
  qty double precision,
  paid numeric not null default 0,
  pos double precision not null default 0
);
create index if not exists an_buys_ing on an_buys (ingredient_id);
create index if not exists an_buys_extra on an_buys (extra_id);

alter table an_buys enable row level security;
revoke all on an_buys from anon;
grant select, insert, update, delete on an_buys to authenticated;
drop policy if exists "grupo logado" on an_buys;
create policy "grupo logado" on an_buys for all to authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table an_buys;
exception when duplicate_object then null;
end $$;

-- Conversão, uma vez só: o valor pago e o "quem pagou" que ficavam no item viram uma linha de compra.
-- Item já marcado como comprado vira "tudo"; valor lançado em item ainda aberto vira quantidade 0.
do $$
begin
  if not exists (select 1 from an_buys) then
    insert into an_buys (id, ingredient_id, who, qty, paid, pos)
      select gen_random_uuid(), id, bought_by, case when bought then null else 0 end, paid, 1
      from an_ingredients where paid > 0 or bought_by <> '';
    insert into an_buys (id, extra_id, who, qty, paid, pos)
      select gen_random_uuid(), id, bought_by, case when done then null else 0 end, paid, 1
      from an_extras where paid > 0 or bought_by <> '';
  end if;
end $$;

-- Histórico: passa a registrar cada compra, e deixa de registrar a marca de "comprado" do item,
-- que agora é só um espelho das compras (senão cada compra apareceria duas vezes).
create or replace function an_log_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; o jsonb; d jsonb;
  t text := substr(tg_table_name, 4);
  lbl text := ''; cx text := ''; em text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    select jsonb_object_agg(n.key, jsonb_build_array(o -> n.key, n.value)) into d
      from jsonb_each(r) n
      where n.key <> 'pos' and n.value is distinct from (o -> n.key)
        and not (t in ('ingredients', 'extras') and n.key in ('bought', 'done', 'bought_by', 'paid'));
    if d is null then return null; end if;
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
  elsif t = 'buys' then
    select name into lbl from an_ingredients where id = (r ->> 'ingredient_id')::uuid;
    if lbl is null then select item into lbl from an_extras where id = (r ->> 'extra_id')::uuid; end if;
    select unit into cx from an_ingredients where id = (r ->> 'ingredient_id')::uuid;
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

drop trigger if exists an_log_trg on an_buys;
create trigger an_log_trg after insert or update or delete on an_buys for each row execute function an_log_write();
