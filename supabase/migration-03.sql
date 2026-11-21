-- Atualização 03: valor pago por item e local de compra dos itens que não são comida. Inclui de novo as colunas da
-- atualização 02, para quem rodou uma versão anterior dela.
-- Pode ser rodado mais de uma vez sem estragar nada.

alter table an_ingredients add column if not exists store text not null default '';
alter table an_ingredients add column if not exists paid numeric not null default 0;
alter table an_recipes add column if not exists reviewed boolean not null default false;
alter table an_recipes add column if not exists reviewed_by text not null default '';
alter table an_extras add column if not exists paid numeric not null default 0;
alter table an_extras add column if not exists store text not null default '';

-- "Alguém leva pronto" e "vem de casa" passam a ser a mesma coisa.
update an_ingredients set from_home = true where when_buy = 'Alguém leva pronto' and not from_home;
