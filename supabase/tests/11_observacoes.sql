\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== Observações da corrida';
insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo, observacoes)
select id, now(), 'Unidade', 'Aeroporto', 'Viagem', 'Mala grande, levar porta-malas livre' from solicitantes limit 1;
insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo)
select id, now(), 'Unidade', 'Centro', 'Visita' from solicitantes limit 1;
select ok('observação gravada na corrida', exists (select 1 from corridas where observacoes like 'Mala grande%'));
select ok('observação é opcional', exists (select 1 from corridas where destino = 'Centro' and observacoes is null));
select ok('lista do painel traz as observações', exists (select 1 from corridas_lista where observacoes like 'Mala grande%'));
select ok('busca encontra pela observação', exists (select 1 from corridas_lista where busca like '%porta-malas%'));
do $$ begin
  update corridas set observacoes = repeat('x', 501) where destino = 'Centro';
  raise notice 'aceitou';
exception when check_violation then null; end $$;
select ok('observação acima de 500 caracteres é recusada', exists (select 1 from corridas where destino = 'Centro' and observacoes is null));
