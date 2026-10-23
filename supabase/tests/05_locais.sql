\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;

select '== Locais frequentes';
insert into locais (nome, endereco, lat, lng) values ('Pronto Socorro Municipal', 'Rua A, 10, Extrema - MG', -22.85, -46.31);
update locais set endereco = 'Rua B, 20, Extrema - MG' where nome = 'Pronto Socorro Municipal';
select ok('trocar o endereço limpa as coordenadas', (select lat is null and lng is null from locais where nome = 'Pronto Socorro Municipal'));
update locais set lat = -22.8, lng = -46.3 where nome = 'Pronto Socorro Municipal';
select ok('gravar coordenadas mantém o valor', (select lat = -22.8 from locais where nome = 'Pronto Socorro Municipal'));
update unidades set lat = 1, lng = 1;
update unidades set endereco_padrao = coalesce(endereco_padrao, '') || ' (novo)';
select ok('unidade com endereço novo perde as coordenadas', (select bool_and(lat is null) from unidades));
