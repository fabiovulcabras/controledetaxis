\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== Código do solicitante e retenção';
select ok('todo solicitante tem código de 4 números', (select bool_and(codigo_acesso ~ '^[0-9]{4}$') from solicitantes));
insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo, origem_lat, origem_lng, paradas, criado_em)
select (select id from solicitantes limit 1), now() - interval '14 months', 'Velha', 'B', 'x', -22.8, -46.3, '[{"texto":"P","lat":-22.7,"lng":-46.2}]', now() - interval '14 months';
insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo, origem_lat, origem_lng)
select (select id from solicitantes limit 1), now() - interval '1 month', 'Nova', 'B', 'x', -22.8, -46.3;
insert into mensagens (direcao, telefone, conteudo, criado_em) values ('entrada', '5535', '{}', now() - interval '13 months'), ('entrada', '5535', '{}', now());
select fn_aplicar_retencao() \g /dev/null
select ok('mensagem antiga apagada, recente mantida', (select count(*) = 1 from mensagens where telefone = '5535'));
select ok('corrida antiga perde as coordenadas (e das paradas), mantém os textos', (select origem_lat is null and paradas->0->>'texto' = 'P' and paradas->0->>'lat' is null from corridas where origem = 'Velha'));
select ok('corrida recente mantém as coordenadas', (select origem_lat is not null from corridas where origem = 'Nova'));
update parametros set valor = '0' where chave = 'retencao_meses';
select ok('retenção 0 = desligada', (select (fn_aplicar_retencao()->>'desligado')::boolean));
