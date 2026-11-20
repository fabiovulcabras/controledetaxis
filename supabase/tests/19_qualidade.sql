\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== Chegada, avaliação, feriados e relatório de qualidade';
insert into corridas (solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo, tipo)
select (select id from solicitantes limit 1), (select id from fornecedores limit 1), '2026-11-10 12:00-03', 'A', 'B', 'x', 'agendada';
select fn_mudar_status((select id from corridas where origem = 'A'), 'enviada', 'sistema') \g /dev/null
select fn_mudar_status((select id from corridas where origem = 'A'), 'aceita', 'fornecedor', null,
  jsonb_build_object('chegada_prevista_em', '2026-11-10 12:00-03', 'motorista', 'Carlos')) \g /dev/null
select fn_mudar_status((select id from corridas where origem = 'A'), null, 'fornecedor', 'Motorista chegou', jsonb_build_object('chegou_em', '2026-11-10 12:03-03')) \g /dev/null
select ok('chegada prevista e real gravadas', (select chegada_prevista_em is not null and chegou_em is not null and motorista = 'Carlos' from corridas where origem = 'A'));
select ok('não avalia corrida não concluída', not fn_avaliar_corrida((select id from corridas where origem = 'A'), 5));
select fn_mudar_status((select id from corridas where origem = 'A'), 'em_andamento', 'fornecedor') \g /dev/null
select fn_mudar_status((select id from corridas where origem = 'A'), 'concluida', 'fornecedor', null, '{"valor_informado": 50}') \g /dev/null
select ok('avalia corrida concluída', fn_avaliar_corrida((select id from corridas where origem = 'A'), 4, '  Motorista educado  '));
select ok('avaliação só uma vez', not fn_avaliar_corrida((select id from corridas where origem = 'A'), 1));
select ok('nota e comentário gravados', (select avaliacao = 4 and avaliacao_comentario = 'Motorista educado' from corridas where origem = 'A'));
do $$ begin perform fn_avaliar_corrida((select id from corridas where origem = 'A'), 7); raise exception 'aceitou'; exception when others then
  if sqlerrm = 'aceitou' then raise; end if; end $$;
select ok('nota fora de 1 a 5 é recusada', true);
-- Dias úteis: sexta 13/11/2026 + 5 dias úteis, com o feriado de 20/11 (sexta) → 23/11 (segunda)
select ok('feriado pula no dia útil', (fn_fim_dia_util('2026-11-13 10:00-03', 5) at time zone 'America/Sao_Paulo')::date = '2026-11-23');
delete from feriados where data = '2026-11-20';
select ok('sem o feriado, volta a ser sexta', (fn_fim_dia_util('2026-11-13 10:00-03', 5) at time zone 'America/Sao_Paulo')::date = '2026-11-20');
select ok('relatório: pontualidade e nota', (select (f->>'no_horario')::int = 1 and (f->>'nota_media')::numeric = 4
  from jsonb_array_elements(fn_relatorio_qualidade('2026-11-01', '2026-12-01')->'fornecedores') f));
select ok('relatório: gasto por setor', (select sum((s->>'corridas')::int) >= 1 from jsonb_array_elements(fn_relatorio_qualidade('2026-11-01', '2026-12-01')->'por_setor') s));
