\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
create function falha_com(rotulo text, comando text, trecho text) returns text language plpgsql as $$
begin execute comando; return '  FALHA ' || rotulo || ' (não deu erro)';
exception when others then return case when sqlerrm ilike '%'||trecho||'%' then '  OK    ' else '  FALHA ' end || rotulo || ' -> ' || sqlerrm; end $$;
create function como(u text) returns void language sql as $$ select set_config('t.uid', u, false); $$;
grant execute on function ok, falha_com, como to authenticated;
\set rtc 'f1000000-0000-0000-0000-000000000001'
\set cte 'f1000000-0000-0000-0000-000000000002'
\set pla '00000000-0000-0000-0000-00000000000b'
\set con '00000000-0000-0000-0000-00000000000c'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@x.com'), (:'pla', 'p@x.com'), (:'con', 'c@x.com');
update profiles set perfil = 'planejamento' where id = :'pla';

select '== Dias úteis';
-- sexta 13/11/2026 10h -> 5º dia útil = sexta 20/11, fim do dia
select ok('5 dias úteis a partir de uma sexta', fn_fim_dia_util('2026-11-13 10:00-03', 5) = '2026-11-20 23:59:59-03');
select ok('2 dias úteis a partir de uma sexta = terça', fn_fim_dia_util('2026-11-13 10:00-03', 2) = '2026-11-17 23:59:59-03');

select '== Corridas do mês';
create function nova(p_id uuid, p_forn uuid, p_inf numeric, p_tab numeric, p_quando timestamptz) returns void language plpgsql as $$
begin
  insert into corridas (id, solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo)
  values (p_id, (select id from solicitantes limit 1), p_forn, p_quando, 'CD Extrema', 'Centro', 'x');
  perform fn_mudar_status(p_id, 'enviada', 'sistema');
  perform fn_mudar_status(p_id, 'aceita', 'fornecedor');
  perform fn_mudar_status(p_id, 'concluida', 'fornecedor', null, case when p_inf is null then '{}'::jsonb else jsonb_build_object('valor_informado', p_inf) end);
  update corridas set valor_tabela = p_tab, preco_fornecedor_id = case when p_tab is not null then p_forn end, preco_calculado_em = now() where id = p_id;
end $$;
select nova('a1000000-0000-0000-0000-000000000001', :'rtc', 80, 60, '2026-10-05 10:00-03');   -- tabela 60 (informou 80)
select nova('a2000000-0000-0000-0000-000000000002', :'rtc', 95, null, '2026-10-20 10:00-03'); -- sem tabela: 95, conferir
select nova('a3000000-0000-0000-0000-000000000003', :'rtc', 70, 70, '2026-10-31 23:30-03');   -- último dia, 23h30 SP
select nova('a4000000-0000-0000-0000-000000000004', :'rtc', 50, 50, '2026-11-01 00:30-03');   -- novembro: fora
select nova('a5000000-0000-0000-0000-000000000005', :'cte', 40, 40, '2026-10-10 10:00-03');   -- outro fornecedor
insert into corridas (id, solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo)
values ('a6000000-0000-0000-0000-000000000006', (select id from solicitantes limit 1), :'rtc', '2026-10-12 10:00-03', 'A', 'B', 'x');
select fn_mudar_status('a6000000-0000-0000-0000-000000000006', 'cancelada', 'bot') \g /dev/null

select '== Extras';
insert into corrida_extras (id, corrida_id, tipo, valor, comprovante) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'pedagio', 12.40, 'extras/x.jpg'),
  ('e2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'espera', 30, 'extras/y.jpg');
set role authenticated;
select como(:'con');
select falha_com('consulta não decide extra', $q$select fn_decidir_extra('e1000000-0000-0000-0000-000000000001', 'aprovado')$q$, 'Sem permissão');
select como(:'pla');
select falha_com('gerar com extra pendente é bloqueado', $q$select fn_gerar_espelho('f1000000-0000-0000-0000-000000000001', '2026-10')$q$, 'aguardando decisão');
select falha_com('recusar exige motivo', $q$select fn_decidir_extra('e2000000-0000-0000-0000-000000000002', 'recusado')$q$, 'motivo');
select fn_decidir_extra('e1000000-0000-0000-0000-000000000001', 'aprovado') \g /dev/null
select fn_decidir_extra('e2000000-0000-0000-0000-000000000002', 'recusado', 'Espera dentro da tolerância') \g /dev/null
select ok('extra aprovado registra quem decidiu', (select status = 'aprovado' and decidido_por = :'pla' from corrida_extras where id = 'e1000000-0000-0000-0000-000000000001'));
select falha_com('planejamento não lança extra direto', $q$insert into corrida_extras (corrida_id, tipo, valor) values ('a1000000-0000-0000-0000-000000000001', 'outro', 5)$q$, 'row-level security');

select '== Gerar espelho';
select set_config('t.esp', fn_gerar_espelho(:'rtc', '2026-10')::text, false) \g /dev/null
select ok('3 corridas de outubro (horário de SP), sem a de novembro, a cancelada e a de outro fornecedor', (select count(*) = 3 from espelho_itens where espelho_id = current_setting('t.esp')::uuid));
select ok('base pela tabela (60) + extra aprovado (12,40); recusado não soma', (select valor_base = 60 and valor_extras = 12.40 and valor_final = 72.40 and base_origem = 'tabela' from espelho_itens where corrida_id = 'a1000000-0000-0000-0000-000000000001'));
select ok('sem tabela usa o informado e pede conferência', (select valor_base = 95 and base_origem = 'informado' and conferir from espelho_itens where corrida_id = 'a2000000-0000-0000-0000-000000000002'));
select ok('total = 72,40 + 95 + 70', (select total = 237.40 and status = 'aguardando' and versao = 1 from espelhos where id = current_setting('t.esp')::uuid));
select ok('prazo no fim do 5º dia útil', (select prazo_em = fn_fim_dia_util(enviado_em, 5) from espelhos where id = current_setting('t.esp')::uuid));
select ok('extras ficam presos ao espelho', (select count(*) = 2 from corrida_extras where espelho_id = current_setting('t.esp')::uuid));
select falha_com('não gera dois espelhos do mesmo mês', $q$select fn_gerar_espelho('f1000000-0000-0000-0000-000000000001', '2026-10')$q$, 'Já existe');
select falha_com('extra depois do espelho é decidido? não', $q$select fn_decidir_extra('e2000000-0000-0000-0000-000000000002', 'aprovado')$q$, 'já está num espelho');
select falha_com('ajuste sem motivo', format('select fn_ajustar_item_espelho(%L, 90, null)', (select id from espelho_itens where corrida_id = 'a2000000-0000-0000-0000-000000000002')), 'motivo');
select fn_ajustar_item_espelho((select id from espelho_itens where corrida_id = 'a2000000-0000-0000-0000-000000000002'), 90, 'Combinado por telefone') \g /dev/null
select ok('ajuste recalcula total e tira o aviso de conferir', (select e.total = 232.40 and not i.conferir from espelhos e join espelho_itens i on i.espelho_id = e.id where i.corrida_id = 'a2000000-0000-0000-0000-000000000002'));
select falha_com('fornecedor não aprova pelo painel', format('select fn_aprovar_espelho(%L, ''fornecedor'')', current_setting('t.esp')), 'permission denied');
reset role;
select falha_com('extra depois do espelho é recusado', $q$insert into corrida_extras (corrida_id, tipo, valor) values ('a1000000-0000-0000-0000-000000000001', 'outro', 5)$q$, 'já está no espelho');

select '== Contestação';
select set_config('t.uid', '', false) \g /dev/null
select falha_com('contestar sem motivo', format($q$select fn_contestar_espelho(%L, '[{"id":"%s","valor":80}]')$q$, current_setting('t.esp'), (select id from espelho_itens where corrida_id = 'a1000000-0000-0000-0000-000000000001')), 'motivo');
select fn_contestar_espelho(current_setting('t.esp')::uuid, jsonb_build_array(
  jsonb_build_object('id', (select id from espelho_itens where corrida_id = 'a1000000-0000-0000-0000-000000000001'), 'motivo', 'Espera de 40 min', 'valor', 102.40),
  jsonb_build_object('id', (select id from espelho_itens where corrida_id = 'a3000000-0000-0000-0000-000000000003'), 'motivo', 'Ida e volta', 'valor', 140))) \g /dev/null
select ok('espelho fica contestado', (select status = 'contestado' from espelhos where id = current_setting('t.esp')::uuid));
select falha_com('não aprova contestado', format('select fn_aprovar_espelho(%L, ''fornecedor'')', current_setting('t.esp')), 'não está aguardando');
set role authenticated;
select como(:'pla');
select falha_com('reemitir com contestação pendente', format('select fn_reemitir_espelho(%L)', current_setting('t.esp')), 'Decida todas');
select falha_com('manter exige resposta', format('select fn_decidir_contestacao(%L, ''mantida'')', (select id from espelho_itens where corrida_id = 'a3000000-0000-0000-0000-000000000003')), 'Explique');
select fn_decidir_contestacao((select id from espelho_itens where corrida_id = 'a1000000-0000-0000-0000-000000000001'), 'aceita', 'Comprovado') \g /dev/null
select fn_decidir_contestacao((select id from espelho_itens where corrida_id = 'a3000000-0000-0000-0000-000000000003'), 'mantida', 'Só ida, conforme a solicitação') \g /dev/null
select ok('aceita usa o valor pedido; total recalculado', (select total = 102.40 + 90 + 70 from espelhos where id = current_setting('t.esp')::uuid));
select fn_reemitir_espelho(current_setting('t.esp')::uuid) \g /dev/null
select ok('reemitido: versão 2, aguardando, novo prazo', (select versao = 2 and status = 'aguardando' and lembrete_enviado_em is null from espelhos where id = current_setting('t.esp')::uuid));
reset role;

select '== Aprovação';
select set_config('t.uid', '', false) \g /dev/null
select falha_com('aprovação tácita antes do prazo', format('select fn_aprovar_espelho(%L, ''tacita'')', current_setting('t.esp')), 'ainda não terminou');
update espelhos set prazo_em = now() - interval '1 minute' where id = current_setting('t.esp')::uuid;
select falha_com('fornecedor não aprova depois do prazo', format('select fn_aprovar_espelho(%L, ''fornecedor'')', current_setting('t.esp')), 'terminou');
select falha_com('fornecedor não contesta depois do prazo', format($q$select fn_contestar_espelho(%L, '[]')$q$, current_setting('t.esp')), 'terminou');
select fn_aprovar_espelho(current_setting('t.esp')::uuid, 'tacita') \g /dev/null
select ok('aprovado tacitamente', (select status = 'aprovado' and aprovacao = 'tacita' from espelhos where id = current_setting('t.esp')::uuid));
select ok('corridas validadas com o valor do espelho', (select bool_and(c.status = 'validada' and c.valor_faturado = i.valor_final) from espelho_itens i join corridas c on c.id = i.corrida_id where i.espelho_id = current_setting('t.esp')::uuid));

select '== NF e pagamento';
set role authenticated;
select como(:'pla');
select falha_com('pagar antes da NF', format('select fn_marcar_pago(%L, current_date)', current_setting('t.esp')), 'depois que o fornecedor enviar');
reset role;
select set_config('t.uid', '', false) \g /dev/null
select falha_com('NF sem PDF', format('select fn_registrar_nf(%L, ''123'', 262.40, '''')', current_setting('t.esp')), 'PDF');
select fn_registrar_nf(current_setting('t.esp')::uuid, '123', 262.40, 'nf/123.pdf') \g /dev/null
select ok('NF registrada e conferida com o espelho', (select status = 'nf_enviada' and nf_valor = total from espelhos where id = current_setting('t.esp')::uuid));
set role authenticated;
select como(:'pla');
select falha_com('pagamento no futuro', format('select fn_marcar_pago(%L, current_date + 5)', current_setting('t.esp')), 'inválida');
select fn_marcar_pago(current_setting('t.esp')::uuid, current_date) \g /dev/null
select ok('pago com quem registrou', (select status = 'pago' and pago_por = :'pla' from espelhos where id = current_setting('t.esp')::uuid));
select ok('histórico completo', (select array_agg(tipo order by criado_em, tipo) @> array['gerado','ajuste','contestacao','decisao','reemitido','aprovado','nf','pago'] from espelho_eventos where espelho_id = current_setting('t.esp')::uuid));
select como(:'con');
select ok('consulta lê o espelho', (select count(*) = 1 from espelhos));
reset role;
