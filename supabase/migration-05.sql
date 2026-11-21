-- Atualização 05: nomes novos de momento e de seção, e marca "congelar".
-- Pode ser rodado mais de uma vez sem estragar nada.

alter table an_ingredients add column if not exists can_freeze boolean not null default false;

update an_ingredients set can_freeze = true where when_buy = 'Antecipado, se congelar';
update an_ingredients set when_buy = 'Antes da viagem' where when_buy in ('Antecipado, se congelar', 'Semana da viagem (até 26/12)', 'Compra à parte');
update an_ingredients set when_buy = 'Lá, durante a semana' where when_buy = 'Fresco / repor lá';
update an_ingredients set when_buy = 'A definir' where when_buy = 'A confirmar';

update an_ingredients set store = 'Feira' where sector = 'Feira' and store = '';
update an_ingredients set sector = 'Hortifruti' where sector = 'Feira';
update an_ingredients set sector = 'Mercearia' where sector = 'Mercado' or sector like 'Feito pel%';
update an_ingredients set sector = 'Açougue e peixaria' where sector = 'Açougue / Peixaria';
update an_ingredients set sector = 'Casa e descartáveis' where sector = 'Casa';
