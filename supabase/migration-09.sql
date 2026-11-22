-- Atualização 09: Black Friday vira marcação, não momento da compra.
-- O item guarda o momento real (antes da viagem, lá, a definir) e, à parte, se vale tentar na Black Friday.
-- Pode ser rodado mais de uma vez sem estragar nada.

alter table an_ingredients add column if not exists bf boolean not null default false;

update an_ingredients set bf = true, when_buy = 'Antes da viagem' where when_buy = 'Black Friday (27/11)';

-- Ingrediente que já existe na casa alugada: sai das listas de compras e de levar.
alter table an_ingredients add column if not exists at_house boolean not null default false;
