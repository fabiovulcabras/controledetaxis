\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;

select '== Relatório por viagem';
-- 4 viagens enviadas ao Rádio Táxi Central: 3 aceitas (30 s) e 1 recusada (90 s); 1 enviada ao Coop sem resposta
insert into corridas (id, solicitante_id, data_hora_prevista, origem, destino, motivo)
select ('c9' || n || '00000-0000-0000-0000-000000000000')::uuid, (select id from solicitantes limit 1), timestamptz '2026-10-10 10:00-03', 'A', 'B', 'teste'
from generate_series(1, 5) n;
insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, fornecedor_id, criado_em)
select ('c9' || n || '00000-0000-0000-0000-000000000000')::uuid, 'solicitada', 'enviada', 'bot',
  case when n = 5 then 'f1000000-0000-0000-0000-000000000002'::uuid else 'f1000000-0000-0000-0000-000000000001'::uuid end, timestamptz '2026-10-10 10:00-03'
from generate_series(1, 5) n;
insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, fornecedor_id, criado_em)
select ('c9' || n || '00000-0000-0000-0000-000000000000')::uuid, 'enviada', case when n = 4 then 'recusada' else 'aceita' end::status_corrida, 'fornecedor',
  'f1000000-0000-0000-0000-000000000001', timestamptz '2026-10-10 10:00-03' + case when n = 4 then interval '90 seconds' else interval '30 seconds' end
from generate_series(1, 4) n;
insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, fornecedor_id, criado_em)
values ('c9500000-0000-0000-0000-000000000000', 'enviada', 'sem_resposta', 'sistema', 'f1000000-0000-0000-0000-000000000002', timestamptz '2026-10-10 10:10-03');

create temp table r as select fn_relatorio(timestamptz '2026-10-01 00:00-03', timestamptz '2026-10-31 23:59-03') as j;
create temp table rf as select x from r, jsonb_array_elements(j->'por_fornecedor') x where x->>'nome' = 'Rádio Táxi Central';
select ok('Rádio: 4 recebidas, 3 aceitas, 1 recusada', (select (x->>'recebidas')::int = 4 and (x->>'aceitas')::int = 3 and (x->>'recusadas')::int = 1 from rf));
select ok('Rádio: resposta média de 0,75 min', (select round((x->>'minutos_resposta')::numeric, 2) = 0.75 from rf));
select ok('geral: 3 aceitas de 5 viagens decididas', (select (j->'viagens'->>'aceitas')::int = 3 and (j->'viagens'->>'decididas')::int = 5 from r));
select ok('filtro por fornecedor mostra só ele', (select jsonb_array_length(fn_relatorio(timestamptz '2026-10-01 00:00-03', timestamptz '2026-10-31 23:59-03',
  'f1000000-0000-0000-0000-000000000002')->'por_fornecedor') = 1));
select ok('Coop: 1 sem resposta', (select (x->>'sem_resposta')::int = 1 from jsonb_array_elements(fn_relatorio(timestamptz '2026-10-01 00:00-03',
  timestamptz '2026-10-31 23:59-03', 'f1000000-0000-0000-0000-000000000002')->'por_fornecedor') x));
