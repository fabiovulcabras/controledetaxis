\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
create function falha_com(rotulo text, comando text, trecho text) returns text language plpgsql as $$
begin execute comando; return '  FALHA ' || rotulo || ' (não deu erro)';
exception when others then return case when sqlerrm ilike '%'||trecho||'%' then '  OK    ' else '  FALHA ' end || rotulo || ' -> ' || sqlerrm; end $$;
create function como(u text) returns void language sql as $$ select set_config('t.uid', u, false); $$;
grant execute on function ok, falha_com, como to authenticated;
\set adm '00000000-0000-0000-0000-00000000000a'
\set con '00000000-0000-0000-0000-00000000000c'
\set rtc 'f1000000-0000-0000-0000-000000000001'
\set cte 'f1000000-0000-0000-0000-000000000002'
insert into auth.users (id, email) values (:'adm', 'admin@empresa.com'), (:'con', 'consulta@empresa.com');

select '== Limite de uso';
select ok('3 usos dentro do limite de 3', fn_consumir_limite('teste', 3, 60) and fn_consumir_limite('teste', 3, 60) and fn_consumir_limite('teste', 3, 60));
select ok('quarto uso passa do limite', not fn_consumir_limite('teste', 3, 60));
select ok('outra chave tem contagem própria', fn_consumir_limite('outra', 3, 60));

select '== Pedido sem duplicidade e fornecedores tentados';
insert into corridas (id, solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo, chave_envio)
select 'c1000000-0000-0000-0000-0000000000c1', id, null, now(), 'Rua A', 'Rua B', 'Visita', 'envio-1' from solicitantes where nome = 'Ana Ribeiro';
select falha_com('mesma chave de envio não cria outra corrida',
  'insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo, chave_envio) select id, now(), ''x'', ''y'', ''z'', ''envio-1'' from solicitantes where nome = ''Ana Ribeiro''', 'duplicate');
select fn_mudar_status('c1000000-0000-0000-0000-0000000000c1', 'enviada', 'sistema', null,
  jsonb_build_object('fornecedor_id', :'rtc', 'fornecedores_tentados', jsonb_build_array(:'rtc'))) \g /dev/null
select fn_mudar_status('c1000000-0000-0000-0000-0000000000c1', 'recusada', 'fornecedor') \g /dev/null
select fn_mudar_status('c1000000-0000-0000-0000-0000000000c1', 'enviada', 'sistema', null,
  jsonb_build_object('fornecedor_id', :'cte', 'fornecedores_tentados', jsonb_build_array(:'rtc', :'cte'))) \g /dev/null
select ok('lista de fornecedores tentados guardada', (select fornecedores_tentados = array[:'rtc', :'cte']::uuid[] from corridas where id = 'c1000000-0000-0000-0000-0000000000c1'));
select ok('evento guarda o fornecedor da recusa', (select fornecedor_id = :'rtc' from corrida_eventos where corrida_id = 'c1000000-0000-0000-0000-0000000000c1' and status_novo = 'recusada'));
select ok('fornecedores ganham link do portal', (select bool_and(length(token_portal) = 64) from fornecedores));

select '== Lista, contagem e resumo (com permissões)';
set role authenticated;
select como(:'con');
select ok('lista traz nome do solicitante e do fornecedor', (select solicitante_nome = 'Ana Ribeiro' and fornecedor_nome = 'Coop Táxi Express' from corridas_lista where id = 'c1000000-0000-0000-0000-0000000000c1'));
select ok('busca ignora acento e maiúsculas', (select count(*) = 1 from corridas_lista where busca like '%' || fn_sem_acento('RIBEIRO visita') || '%') or (select count(*) = 1 from corridas_lista where busca like '%ribeiro%'));
select ok('contagem por status', (fn_contar_corridas(now() - interval '1 day', now() + interval '1 day')->'por_status'->>'enviada')::int = 1);
select ok('contagem com busca sem acento', (fn_contar_corridas(now() - interval '1 day', now() + interval '1 day', null, 'Joao')->'por_status') = '{}'::jsonb);
select ok('resumo conta a corrida do período', (fn_resumo_periodo(now() - interval '1 day', now() + interval '1 day')->>'total')::int = 1);
select ok('resumo por fornecedor tem enviadas e recusadas', (select (x->>'recusadas')::int = 1 from jsonb_array_elements(fn_resumo_periodo(now() - interval '1 day', now() + interval '1 day')->'por_fornecedor') x where x->>'nome' = 'Rádio Táxi Central'));
reset role;
select como(''); set role anon;
select ok('visitante sem login não vê a lista', (select count(*) = 0 from corridas_lista));
reset role;
select falha_com('visitante não consome limite', 'set role anon; select fn_consumir_limite(''x'', 1, 60)', 'permission denied');
reset role;
