\set QUIET on
\pset tuples_only on
\pset format unaligned
-- utilitários (criados como superusuário, executam com o papel de quem chama)
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
create function falha_com(rotulo text, comando text, trecho text) returns text language plpgsql as $$
begin execute comando; return '  FALHA ' || rotulo || ' (não deu erro)';
exception when others then return case when sqlerrm ilike '%'||trecho||'%' then '  OK    ' else '  FALHA ' end || rotulo || ' -> ' || sqlerrm; end $$;
create function como(u text) returns void language sql as $$ select set_config('t.uid', u, false); $$;
grant execute on function ok, falha_com, como to authenticated;

\set adm '00000000-0000-0000-0000-00000000000a'
\set pla '00000000-0000-0000-0000-00000000000b'
\set con '00000000-0000-0000-0000-00000000000c'
\set ana_id '51000000-0000-0000-0000-000000000001'
\set rtc 'f1000000-0000-0000-0000-000000000001'
\set cte 'f1000000-0000-0000-0000-000000000002'

select '== Usuários';
insert into auth.users (id, email) values (:'adm', 'admin@empresa.com'), (:'pla', 'plan@empresa.com'), (:'con', 'consulta@empresa.com');
select ok('primeiro usuário vira admin', (select perfil from profiles where id = :'adm') = 'admin');
select ok('demais entram como consulta', (select perfil from profiles where id = :'con') = 'consulta');
update profiles set perfil = 'planejamento' where id = :'pla';
update solicitantes set id = :'ana_id' where telefone_whatsapp = '5511900000001';

select '== Protocolo';
insert into corridas (solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo)
values (:'ana_id', :'rtc', now() + interval '10 min', 'Unidade Centro', 'Aeroporto GRU', 'Viagem a cliente');
insert into corridas (solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo)
values (:'ana_id', :'rtc', now() + interval '1 day', 'Unidade Centro', 'Rodoviária', 'Hora extra');
select ok('formato TX-AAAA-NNNNN', (select bool_and(protocolo ~ '^TX-[0-9]{4}-[0-9]{5}$') from corridas));
select ok('sequencial', (select array_agg(right(protocolo, 5) order by criado_em, protocolo) from corridas) = array['00001','00002']);
select ok('evento inicial registrado', (select count(*) from corrida_eventos) = 2);
select set_config('t.c1', (select id::text from corridas where destino = 'Aeroporto GRU'), false) \g /dev/null
select set_config('t.c2', (select id::text from corridas where destino = 'Rodoviária'), false) \g /dev/null

select '== Fluxo de status (servidor)';
select fn_mudar_status(current_setting('t.c1')::uuid, 'enviada', 'sistema', 'Enviada', jsonb_build_object('prazo_resposta_em', now() + interval '10 min')) \g /dev/null
select fn_mudar_status(current_setting('t.c1')::uuid, 'aceita', 'fornecedor', null, '{}') \g /dev/null
select fn_mudar_status(current_setting('t.c1')::uuid, null, 'fornecedor', 'Motorista informado', jsonb_build_object('motorista','Carlos Souza','veiculo_placa','RTX4F21','eta_minutos',12)) \g /dev/null
select ok('campos atualizados sem mudar status', (select status = 'aceita' and motorista = 'Carlos Souza' and eta_minutos = 12 from corridas where id = current_setting('t.c1')::uuid));
select falha_com('bloqueia aceita → validada', format('select fn_mudar_status(%L, ''validada'', ''planejamento'')', current_setting('t.c1')), 'não permitida');
select fn_mudar_status(current_setting('t.c1')::uuid, 'em_andamento', 'fornecedor') \g /dev/null
select fn_mudar_status(current_setting('t.c1')::uuid, 'concluida', 'fornecedor', null, jsonb_build_object('valor_informado', 68.50)) \g /dev/null
select ok('valor informado gravado', (select valor_informado = 68.50 from corridas where id = current_setting('t.c1')::uuid));
select ok('linha do tempo completa', (select count(*) from corrida_eventos where corrida_id = current_setting('t.c1')::uuid) = 6);
select falha_com('update direto também respeita transições', format('update corridas set status = ''enviada'' where id = %L', current_setting('t.c1')), 'não permitida');

select '== Permissões';
set role authenticated;
select como(:'con');
select ok('consulta lê corridas', (select count(*) from corridas) = 2);
select falha_com('consulta não muda status', format('select fn_mudar_status(%L, ''validada'', ''planejamento'')', current_setting('t.c1')), 'Sem permissão');
select falha_com('consulta não cadastra fornecedor', 'insert into fornecedores (nome, telefone_whatsapp) values (''X'', ''5511911112222'')', 'row-level security');
select ok('consulta não vê conversas do bot', (select count(*) from conversas_bot) = 0);
update corridas set motivo = 'x' where id = current_setting('t.c1')::uuid;
select ok('update direto não tem efeito', (select motivo from corridas where id = current_setting('t.c1')::uuid) = 'Viagem a cliente');

select como(:'pla');
select fn_mudar_status(current_setting('t.c1')::uuid, 'validada', 'planejamento', null) \g /dev/null
select ok('planejamento valida e fica registrado quem validou', (select status = 'validada' and validado_por = :'pla' from corridas where id = current_setting('t.c1')::uuid));
select falha_com('reabrir validada exige justificativa', format('select fn_mudar_status(%L, ''contestada'', ''planejamento'', '''')', current_setting('t.c1')), 'justificativa');
select falha_com('planejamento não cadastra fornecedor', 'insert into fornecedores (nome, telefone_whatsapp) values (''X'', ''5511911112222'')', 'row-level security');

select como(:'adm');
insert into fornecedores (nome, telefone_whatsapp) values ('Táxi Novo', '5511911112222');
select ok('admin cadastra fornecedor', (select count(*) from fornecedores where nome = 'Táxi Novo') = 1);
select falha_com('telefone precisa ser só dígitos com DDI', 'insert into fornecedores (nome, telefone_whatsapp) values (''Y'', ''(11) 9999-0000'')', 'check');
reset role;

select '== Conciliação';
-- c2: concluída por 54,00
select fn_mudar_status(current_setting('t.c2')::uuid, 'enviada', 'sistema') \g /dev/null
select fn_mudar_status(current_setting('t.c2')::uuid, 'aceita', 'fornecedor') \g /dev/null
select fn_mudar_status(current_setting('t.c2')::uuid, 'concluida', 'fornecedor', null, jsonb_build_object('valor_informado', 54)) \g /dev/null
-- c3: cancelada; c4: concluída sem valor
insert into corridas (id, solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo)
values ('c3000000-0000-0000-0000-000000000003', :'ana_id', :'rtc', now(), 'A', 'B', 'x'),
       ('c4000000-0000-0000-0000-000000000004', :'ana_id', :'cte', now(), 'A', 'B', 'x');
select fn_mudar_status('c3000000-0000-0000-0000-000000000003', 'cancelada', 'bot') \g /dev/null

set role authenticated;
select como(:'pla');
insert into faturas (id, fornecedor_id, competencia, numero_nf) values ('fa000000-0000-0000-0000-000000000001', :'rtc', '2026-10', '8231');
insert into fatura_itens (fatura_id, data_corrida, protocolo_informado, valor) values
  ('fa000000-0000-0000-0000-000000000001', current_date, (select protocolo from corridas where id = current_setting('t.c1')::uuid), 70.00),
  ('fa000000-0000-0000-0000-000000000001', current_date, lower((select protocolo from corridas where id = current_setting('t.c2')::uuid)), 72.00),
  ('fa000000-0000-0000-0000-000000000001', current_date, (select protocolo from corridas where id = 'c3000000-0000-0000-0000-000000000003'), 25.00),
  ('fa000000-0000-0000-0000-000000000001', current_date, (select protocolo from corridas where id = 'c4000000-0000-0000-0000-000000000004'), 40.00),
  ('fa000000-0000-0000-0000-000000000001', current_date, '', 48.00),
  ('fa000000-0000-0000-0000-000000000001', current_date, (select protocolo from corridas where id = current_setting('t.c1')::uuid), 70.00);
select fn_conciliar_fatura('fa000000-0000-0000-0000-000000000001') \g /dev/null
select ok('dentro da tolerância = conciliado (68,50 x 70,00)', (select situacao from fatura_itens i join corridas c on c.id = i.corrida_id where c.id = current_setting('t.c1')::uuid order by i.id limit 1) = 'conciliado');
select ok('protocolo em minúsculas ainda casa; 54 x 72 = divergente', (select situacao from fatura_itens where valor = 72) = 'divergente');
select ok('corrida cancelada é apontada', (select situacao from fatura_itens where valor = 25) = 'cancelada');
select ok('corrida de outro fornecedor é apontada', (select situacao from fatura_itens where valor = 40) = 'outro_fornecedor');
select ok('item sem protocolo', (select situacao from fatura_itens where valor = 48) = 'sem_protocolo');
select ok('protocolo repetido na fatura = duplicado', (select count(*) from fatura_itens where situacao = 'duplicado') = 1);
select ok('valor faturado gravado na corrida', (select valor_faturado = 72 from corridas where id = current_setting('t.c2')::uuid));
select ok('total da fatura calculado', (select valor_total = 325 from faturas where id = 'fa000000-0000-0000-0000-000000000001'));

select fn_decidir_item((select id from fatura_itens where valor = 72), 'contestado', 'Valor acima do informado') \g /dev/null
select ok('contestar item marca a corrida como contestada', (select status from corridas where id = current_setting('t.c2')::uuid) = 'contestada');
select fn_decidir_item((select id from fatura_itens where valor = 72), 'aceito', 'Fornecedor comprovou pedágio') \g /dev/null
select ok('aceitar depois valida a corrida', (select status from corridas where id = current_setting('t.c2')::uuid) = 'validada');
select falha_com('contestar item conciliado exige motivo', format('select fn_decidir_item(%L, ''contestado'')', (select id from fatura_itens where situacao = 'conciliado' limit 1)), 'motivo');
select fn_decidir_item(id, 'contestado', 'Sem respaldo') from fatura_itens where decisao is null and situacao <> 'conciliado' \g /dev/null
select fn_decidir_item(id, 'aceito') from fatura_itens where decisao is null \g /dev/null
select ok('fatura fica conciliada quando todos os itens têm decisão', (select status from faturas where id = 'fa000000-0000-0000-0000-000000000001') = 'conciliada');

select como(:'con');
select falha_com('consulta não decide itens', format('select fn_decidir_item(%L, ''aceito'')', (select id from fatura_itens limit 1)), 'Sem permissão');
select falha_com('consulta não importa fatura', format('insert into faturas (fornecedor_id, competencia) values (%L, ''2026-10'')', :'rtc'), 'row-level security');
reset role;
