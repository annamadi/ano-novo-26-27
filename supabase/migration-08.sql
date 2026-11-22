-- Atualização 08: conferência por ingrediente.
-- Cada linha de receita guarda os nomes de quem conferiu ingrediente e quantidade.
-- Pode ser rodado mais de uma vez sem estragar nada.

alter table an_recipe_items add column if not exists checked_by text not null default '';

-- O que não era sugestão da IA veio do caderno: entra como já conferido.
update an_recipe_items set checked_by = 'Caderno' where checked_by = '' and suggested = false;
