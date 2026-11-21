-- Atualização 07: receita levada pronta por alguém.
-- Pode ser rodado mais de uma vez sem estragar nada.

alter table an_recipes add column if not exists brought boolean not null default false;
alter table an_recipes add column if not exists owner text not null default '';
alter table an_recipes add column if not exists brought_done boolean not null default false;
