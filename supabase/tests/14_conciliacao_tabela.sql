\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
\set rtc 'f1000000-0000-0000-0000-000000000001'
\set cte 'f1000000-0000-0000-0000-000000000002'

select '== Conciliação com a tabela de preços';
create function nova(p_id uuid, p_inf numeric, p_tab numeric, p_forn_preco uuid) returns void language plpgsql as $$
begin
  insert into corridas (id, solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo)
  values (p_id, (select id from solicitantes limit 1), 'f1000000-0000-0000-0000-000000000001', now(), 'CD Extrema', 'Centro', 'x');
  perform fn_mudar_status(p_id, 'enviada', 'sistema');
  perform fn_mudar_status(p_id, 'aceita', 'fornecedor');
  perform fn_mudar_status(p_id, 'concluida', 'fornecedor', null, case when p_inf is null then '{}'::jsonb else jsonb_build_object('valor_informado', p_inf) end);
  update corridas set valor_tabela = p_tab, preco_fornecedor_id = p_forn_preco, preco_calculado_em = now() where id = p_id;
end $$;
-- a: informado 80 = cobrado 80, tabela 60 -> acima da tabela
select nova('a0000000-0000-0000-0000-00000000000a', 80, 60, :'rtc');
-- b: informado 60, cobrado 60, tabela 60 -> conciliado
select nova('b0000000-0000-0000-0000-00000000000b', 60, 60, :'rtc');
-- c: sem valor informado, cobrado 55, tabela 60 -> conciliado pela tabela
select nova('c0000000-0000-0000-0000-00000000000c', null, 60, :'rtc');
-- d: tabela calculada para outro fornecedor -> ignora a tabela; 80 x 80 conciliado
select nova('d0000000-0000-0000-0000-00000000000d', 80, 60, :'cte');
-- e: sem tabela e sem valor -> sem valor
select nova('e0000000-0000-0000-0000-00000000000e', null, null, null);

insert into faturas (id, fornecedor_id, competencia) values ('fb000000-0000-0000-0000-000000000001', :'rtc', to_char(now(), 'YYYY-MM'));
insert into fatura_itens (fatura_id, protocolo_informado, valor)
select 'fb000000-0000-0000-0000-000000000001', protocolo, v from (values
  ('a0000000-0000-0000-0000-00000000000a'::uuid, 80), ('b0000000-0000-0000-0000-00000000000b'::uuid, 60),
  ('c0000000-0000-0000-0000-00000000000c'::uuid, 55), ('d0000000-0000-0000-0000-00000000000d'::uuid, 80),
  ('e0000000-0000-0000-0000-00000000000e'::uuid, 50)) x(id, v) join corridas c on c.id = x.id;
select fn_conciliar_fatura('fb000000-0000-0000-0000-000000000001') \g /dev/null
create function sit(p uuid) returns text language sql as $$ select situacao from fatura_itens where corrida_id = p $$;
select ok('cobrado acima da tabela, mesmo igual ao informado = acima_tabela', sit('a0000000-0000-0000-0000-00000000000a') = 'acima_tabela');
select ok('igual à tabela e ao informado = conciliado', sit('b0000000-0000-0000-0000-00000000000b') = 'conciliado');
select ok('sem valor informado, dentro da tabela = conciliado', sit('c0000000-0000-0000-0000-00000000000c') = 'conciliado');
select ok('tabela de outro fornecedor não vale', sit('d0000000-0000-0000-0000-00000000000d') = 'conciliado');
select ok('sem tabela e sem valor = sem_valor', sit('e0000000-0000-0000-0000-00000000000e') = 'sem_valor');
update parametros set valor = '25' where chave = 'tolerancia_tabela_valor';
select fn_conciliar_fatura('fb000000-0000-0000-0000-000000000001') \g /dev/null
select ok('tolerância da tabela (R$ 25) aceita 80 sobre 60', sit('a0000000-0000-0000-0000-00000000000a') = 'conciliado');
