-- Atualização 06: conversa dentro de cada pendência.
-- Pode ser rodado mais de uma vez sem estragar nada.

create table if not exists an_comments (
  id uuid primary key,
  pend_id uuid not null references an_pendencias(id) on delete cascade,
  author text not null default '',
  body text not null default '',
  created_at timestamptz not null default now()
);

alter table an_comments enable row level security;
revoke all on an_comments from anon;
grant select, insert, update, delete on an_comments to authenticated;
drop policy if exists "grupo logado" on an_comments;
create policy "grupo logado" on an_comments for all to authenticated using (true) with check (true);
do $$
begin
  alter publication supabase_realtime add table an_comments;
exception when duplicate_object then null;
end $$;
