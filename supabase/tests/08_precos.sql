\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;

select '== Tabela de preços';
insert into fornecedores (id, nome, telefone_whatsapp, prioridade, prazo_resposta_min)
values ('f8000000-0000-0000-0000-000000000008', 'Reinaldo Táxi', '5511900008888', 5, 5);
select ok('carga da Tabela 2026 do Reinaldo', fn_carregar_tabela_reinaldo_2026('f8000000-0000-0000-0000-000000000008') = 71);
select ok('carregar de novo não duplica', fn_carregar_tabela_reinaldo_2026('f8000000-0000-0000-0000-000000000008') = 0);
select ok('Toledo - Pereiras, passeio, destino único = 234', (select valor = 234 from precos_tabela
  where fornecedor_id = 'f8000000-0000-0000-0000-000000000008' and bairro = 'Pereiras' and modalidade = 'unico' and veiculo = 'passeio'));
select ok('Extrema central (sem bairro), van, diversos = 249', (select valor = 249 from precos_tabela
  where fornecedor_id = 'f8000000-0000-0000-0000-000000000008' and cidade = 'Extrema' and bairro is null and modalidade = 'diversos' and veiculo = 'van'));
select ok('Atibaia só com passeio', (select count(*) = 1 from precos_tabela where fornecedor_id = 'f8000000-0000-0000-0000-000000000008' and cidade = 'Atibaia'));
select ok('lista de corridas traz o valor de tabela', (select count(*) = 1 from information_schema.columns where table_name = 'corridas_lista' and column_name = 'valor_tabela'));
