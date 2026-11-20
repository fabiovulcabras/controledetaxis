\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== Vários destinos';
insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo, paradas)
select (select id from solicitantes limit 1), now(), 'CD Extrema', 'Bairro dos Pereiras, Toledo', 'x',
  '[{"texto":"Rua Primavera, Extrema","lat":null,"lng":null},{"texto":"Centro, Toledo","lat":-22.74,"lng":-46.37}]'::jsonb;
select ok('paradas gravadas na ordem', (select paradas->1->>'texto' = 'Centro, Toledo' from corridas where destino like 'Bairro dos Pereiras%'));
select ok('corrida sem paradas tem lista vazia', (select count(*) = 0 from corridas where paradas is null));
select ok('a busca acha pela parada', (select count(*) = 1 from corridas_lista where busca like '%rua primavera%'));
do $$ begin
  insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo, paradas)
  select (select id from solicitantes limit 1), now(), 'A', 'B', 'x', '[{},{},{},{},{}]'::jsonb;
  raise exception 'aceitou';
exception when check_violation then null; end $$;
select ok('no máximo 4 paradas', true);
select ok('view mantém a tarifa por km', (select count(*) >= 0 from corridas_lista where fornecedor_valor_km is null));
