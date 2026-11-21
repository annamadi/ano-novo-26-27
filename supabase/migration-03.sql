-- Atualização 03: valor pago por item. Inclui de novo as colunas da
-- atualização 02, para quem rodou uma versão anterior dela.
-- Pode ser rodado mais de uma vez sem estragar nada.

alter table an_ingredients add column if not exists store text not null default '';
alter table an_ingredients add column if not exists paid numeric not null default 0;
alter table an_recipes add column if not exists reviewed boolean not null default false;
alter table an_recipes add column if not exists reviewed_by text not null default '';
alter table an_extras add column if not exists paid numeric not null default 0;
