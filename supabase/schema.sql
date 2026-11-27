-- Ano Novo 26/27: tabelas do site. Rode uma vez no SQL Editor do Supabase.
-- Todas com prefixo an_ para conviver com outros apps no mesmo projeto.

create table if not exists an_ingredients (
  id uuid primary key,
  name text not null,
  unit text not null default 'un',
  sector text not null default '',
  when_buy text not null default '',
  buy_hint text not null default '',
  bought boolean not null default false,
  from_home boolean not null default false,
  owner text not null default '',
  note text not null default '',
  store text not null default '',
  paid numeric not null default 0,
  bought_by text not null default '',
  hint_qty numeric,
  can_freeze boolean not null default false,
  bf boolean not null default false,
  at_house boolean not null default false
);

create table if not exists an_recipes (
  id uuid primary key,
  name text not null,
  block text not null default 'Jantar',
  serves text not null default '',
  weekly boolean not null default false,
  notes text not null default '',
  prep text not null default '',
  reviewed boolean not null default false,
  reviewed_by text not null default '',
  brought boolean not null default false,
  owner text not null default '',
  brought_done boolean not null default false,
  pos double precision not null default 0
);

create table if not exists an_recipe_items (
  id uuid primary key,
  recipe_id uuid not null references an_recipes(id) on delete cascade,
  ingredient_id uuid not null references an_ingredients(id) on delete cascade,
  qty double precision not null default 0,
  suggested boolean not null default false,
  veg text not null default '',
  note text not null default '',
  pos double precision not null default 0,
  checked_by text not null default '',
  kind text not null default ''
);

create table if not exists an_days (
  id uuid primary key,
  date date not null,
  people integer not null default 7,
  veg_guest boolean not null default false,
  breakfast boolean not null default true,
  veg_option text not null default '',
  notes text not null default ''
);

create table if not exists an_menu (
  id uuid primary key,
  day_id uuid not null references an_days(id) on delete cascade,
  recipe_id uuid not null references an_recipes(id) on delete cascade,
  pos double precision not null default 0
);

create table if not exists an_pendencias (
  id uuid primary key,
  kind text not null default 'Dúvida',
  subject text not null default '',
  detail text not null default '',
  answer text not null default '',
  done boolean not null default false,
  recipe_id uuid references an_recipes(id) on delete cascade,
  pos double precision not null default 0
);

create table if not exists an_trash (
  id uuid primary key,
  tbl text not null default '',
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  deleted_by text not null default '',
  deleted_at timestamptz not null default now()
);

create table if not exists an_comments (
  id uuid primary key,
  pend_id uuid not null references an_pendencias(id) on delete cascade,
  author text not null default '',
  body text not null default '',
  created_at timestamptz not null default now()
);

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

create table if not exists an_extras (
  id uuid primary key,
  grp text not null default 'Levar',
  item text not null default '',
  owner text not null default '',
  done boolean not null default false,
  buy boolean not null default false,
  paid numeric not null default 0,
  store text not null default '',
  bought_by text not null default '',
  activity_id uuid references an_activities(id) on delete cascade,
  pos double precision not null default 0
);

-- Só quem fez login lê ou altera. Sem login, nada é entregue.
do $$
declare t text;
begin
  foreach t in array array['an_ingredients','an_recipes','an_recipe_items','an_days','an_menu','an_pendencias','an_extras','an_people','an_activities','an_trash','an_comments']
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

-- Histórico de alterações: quem grava é o próprio banco; o site só lê.

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

-- Compras por pessoa (substitui o an_log_write acima por uma versão que também registra as compras).
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
