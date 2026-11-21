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
  hint_qty numeric
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
  pos double precision not null default 0
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
  foreach t in array array['an_ingredients','an_recipes','an_recipe_items','an_days','an_menu','an_pendencias','an_extras','an_people','an_activities','an_trash']
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
