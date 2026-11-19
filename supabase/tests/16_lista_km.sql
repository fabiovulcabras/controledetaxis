\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== Lista de corridas com km e tarifa';
update fornecedores set valor_km = 5.55, bandeirada = 0;
insert into corridas (solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo) select (select id from solicitantes limit 1), (select id from fornecedores limit 1), now(), 'A', 'B', 'x';
select ok('a view traz a tarifa por km do fornecedor', (select count(*) > 0 from corridas_lista where fornecedor_valor_km = 5.55));
select ok('a view traz as colunas da 016', (select count(*) >= 0 from corridas_lista where distancia_fonte is null));
select ok('contagem por status continua funcionando', fn_contar_corridas(now() - interval '10 years', now() + interval '10 years') ? 'por_status');
